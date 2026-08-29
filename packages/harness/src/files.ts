// ═════════════════════════════════════════════════════════════════════════════
// Reading a .axis file off disk, imports and all
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler never touches a filesystem — it asks a host for an import's
// source. This is that host for Node, resolving specifiers the same way the
// VSCode extension does, so a script that previews in the editor compiles here.

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import {
    ImageHost,
    ImportHost,
    ResolveImage,
    ResolveImport,
    createImageResolver,
    createImportResolver,
    loadImages,
    loadImports,
} from '@axis-dsl/compiler';
import { withAxisExtension } from '@axis-dsl/language';

/**
 * Reads imports relative to the importing file. A leading `/` is relative to
 * `root` instead, which is the workspace folder in the editor and the script's
 * own directory here.
 */
export function nodeImportHost(root: string = process.cwd()): ImportHost {
    return {
        resolve: (specifier, from) => {
            const target = withAxisExtension(specifier);
            return target.startsWith('/')
                ? resolvePath(root, target.slice(1))
                : resolvePath(dirname(from), target);
        },
        read: path => readFile(path, 'utf8'),
    };
}

/**
 * Reads an image beside the file that draws it, the same way imports are read -
 * a path is a path whichever statement writes it - but with no extension
 * implied, since a picture is named in full.
 */
export function nodeImageHost(root: string = process.cwd()): ImageHost {
    return {
        resolve: (url, from) =>
            url.startsWith('/') ? resolvePath(root, url.slice(1)) : resolvePath(dirname(from), url),
        read: async path => new Uint8Array(await readFile(path)),
    };
}

/** A script and the resolvers its imports and images need, ready for the compiler. */
export interface LoadedScript {
    path: string;
    source: string;
    resolveImport: ResolveImport;
    resolveImage: ResolveImage;
}

/**
 * Read the script at `path`, every file it imports, transitively, and every
 * image any of them draws.
 */
export async function readAxisFile(path: string, root?: string): Promise<LoadedScript> {
    const absolute = resolvePath(path);
    const base = root ?? dirname(absolute);
    const host = nodeImportHost(base);
    const pictures = nodeImageHost(base);
    const source = await readFile(absolute, 'utf8');
    const files = await loadImports({ path: absolute, source }, host);
    const images = await loadImages({ path: absolute, source }, files, pictures);

    return {
        path: absolute,
        source,
        resolveImport: createImportResolver(files, host.resolve),
        resolveImage: createImageResolver(images, pictures.resolve),
    };
}
