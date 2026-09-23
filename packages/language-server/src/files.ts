// ═════════════════════════════════════════════════════════════════════════════
// Files - the documents the client holds, and the disk behind them
// ═════════════════════════════════════════════════════════════════════════════
//
// The language service never touches a file system; the compiler asks for an
// import's source and an image's picture through callbacks. This is what
// answers them in the server: an open document by the text the client sent,
// since that is what the user is looking at and it may not be saved, and
// anything else off disk with `node:fs`.

import { readdir, readFile, stat } from 'node:fs/promises';
import type { DirectoryEntry } from '@axis-dsl/language-service';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { fsPathOf, normalizeUri } from './paths';

/** Where a URI's contents come from: the client's copy when it has one open. */
export interface DocumentSource {
    get(uri: string): TextDocument | undefined;
}

export class FileSystem {
    constructor(private readonly documents: DocumentSource) {}

    /** The open document at `uri`, however the client happened to spell it. */
    public document(uri: string): TextDocument | undefined {
        return this.documents.get(uri) ?? this.documents.get(normalizeUri(uri));
    }

    /** A script's source. Rejects when there is no such file, which is what the compiler's loader expects. */
    public async readText(uri: string): Promise<string> {
        const open = this.document(uri);
        if (open) {
            return open.getText();
        }
        return readFile(this.pathOf(uri), 'utf8');
    }

    /** Whether there is a file - not a directory - at `uri`. */
    public async isFile(uri: string): Promise<boolean> {
        if (this.document(uri)) {
            return true;
        }
        try {
            return (await stat(this.pathOf(uri))).isFile();
        } catch {
            return false;
        }
    }

    /** What is in the directory at `uri`, or nothing when it is not one that can be read. */
    public async listDirectory(uri: string): Promise<DirectoryEntry[]> {
        try {
            const entries = await readdir(this.pathOf(uri), { withFileTypes: true });
            return entries.map(entry => ({ name: entry.name, directory: entry.isDirectory() }));
        } catch {
            return [];
        }
    }

    private pathOf(uri: string): string {
        const path = fsPathOf(uri);
        if (path === undefined) {
            // An `untitled:` buffer, or a scheme only the client can read.
            throw new Error(`Not a file on disk: ${uri}`);
        }
        return path;
    }
}
