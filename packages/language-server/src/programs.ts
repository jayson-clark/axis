// ═════════════════════════════════════════════════════════════════════════════
// Programs - one version of a document, with everything it imports in hand
// ═════════════════════════════════════════════════════════════════════════════
//
// The language service is synchronous and so is the compiler under it, but
// reading a file is not. So the reading is done first, once per version of a
// document: its imports are walked with the compiler's own `loadImports`, its
// pictures looked for with `loadImages`, and the result frozen into resolvers
// that answer from memory. Every request against that version - diagnostics,
// hover, completion, tokens, definition - is then answered from one parse and
// one set of resolvers, which is also what lets the service's per-tree caches
// hit.
//
// A snapshot remembers every file it asked for, found or not. That set is what
// decides which documents to check again when a file changes: an import that
// changed on disk, a picture that was saved, a missing file that has just been
// created.

import {
    createImageResolver,
    createImportResolver,
    loadImages,
    loadImports,
    type ImageHost,
    type ImportHost,
} from '@axis-dsl/compiler';
import { imageMediaType, type ProgramOptions } from '@axis-dsl/language-service';
import { parse, type SyntaxTree } from '@axis-dsl/syntax';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { FileSystem } from './files';
import { normalizeUri, resolveImageUri, resolveImportUri } from './paths';

/** One version of one document, ready to be asked about. */
export interface Snapshot {
    uri: string;
    version: number;
    tree: SyntaxTree;
    /** The compiler's resolvers over the files this version reads, and its path. */
    options: ProgramOptions;
    /** Every file this version asked for, as a normalized URI - including ones that were not there. */
    dependencies: ReadonlySet<string>;
}

/**
 * The picture's bytes are nothing to the editor, which throws the compiled
 * graph away and keeps only the diagnostics: that the file is there is all.
 * So an image is checked for rather than read and base64'd on every keystroke,
 * and resolves to a `data:` URI with nothing in it.
 */
const EMPTY = new Uint8Array(0);

export class Programs {
    private readonly snapshots = new Map<
        string,
        { version: number; snapshot: Promise<Snapshot> }
    >();

    constructor(
        private readonly files: FileSystem,
        private readonly roots: () => readonly string[],
    ) {}

    /** The snapshot of the document's current version, loading it if this is the first ask. */
    public get(document: TextDocument): Promise<Snapshot> {
        const cached = this.snapshots.get(document.uri);
        if (cached && cached.version === document.version) {
            return cached.snapshot;
        }
        const snapshot = this.load(document);
        this.snapshots.set(document.uri, { version: document.version, snapshot });
        // A failed load is not kept, so the next request tries again.
        snapshot.catch(() => {
            if (this.snapshots.get(document.uri)?.snapshot === snapshot) {
                this.snapshots.delete(document.uri);
            }
        });
        return snapshot;
    }

    /** Forget a document's snapshot, so the next request reads its files afresh. */
    public invalidate(uri: string): void {
        this.snapshots.delete(uri);
    }

    /**
     * The open documents whose snapshot read `uri` - or tried to - and so
     * would read something different now that it has changed.
     */
    public async dependents(uri: string): Promise<string[]> {
        const changed = normalizeUri(uri);
        const found: string[] = [];
        for (const [document, { snapshot }] of this.snapshots) {
            try {
                if ((await snapshot).dependencies.has(changed)) {
                    found.push(document);
                }
            } catch {
                // A snapshot that failed to load depends on nothing yet.
            }
        }
        return found;
    }

    private async load(document: TextDocument): Promise<Snapshot> {
        // Normalized, so the entry compares equal to itself when a cycle
        // imports it back under the spelling the resolver writes.
        const path = normalizeUri(document.uri);
        const source = document.getText();
        const dependencies = new Set<string>();

        // Each resolution is recorded as it is made, which catches the files
        // that turn out not to exist as well as the ones that do.
        const record = (uri: string) => {
            dependencies.add(normalizeUri(uri));
            return uri;
        };
        const importHost: ImportHost = {
            resolve: (specifier, from) => record(resolveImportUri(from, specifier, this.roots())),
            read: uri => this.files.readText(uri),
        };
        const imageHost: ImageHost = {
            resolve: (url, from) => record(resolveImageUri(from, url, this.roots())),
            read: async uri => {
                if (imageMediaType(uri) === undefined || !(await this.files.isFile(uri))) {
                    throw new Error(`No picture at ${uri}`);
                }
                return EMPTY;
            },
        };

        const entry = { path, source };
        const imported = await loadImports(entry, importHost);
        const images = await loadImages(entry, imported, imageHost);

        return {
            uri: document.uri,
            version: document.version,
            tree: parse(source),
            options: {
                path,
                resolveImport: createImportResolver(imported, importHost.resolve),
                resolveImage: createImageResolver(images, imageHost.resolve),
            },
            dependencies,
        };
    }
}
