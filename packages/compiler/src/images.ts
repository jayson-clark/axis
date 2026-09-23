// ═════════════════════════════════════════════════════════════════════════════
// Images - turning a picture beside the file into something Desmos can draw
// ═════════════════════════════════════════════════════════════════════════════
//
// `image "./beach.png"` names a file the way `import` does, and the compiler
// reaches it the same way: it never touches a filesystem, it asks for the
// picture through a {@link ResolveImage} callback and is handed a data URI
// back. A graph has to carry its pictures with it - Desmos stores an image as
// its URL, and a path on the machine the file was written on is not one any
// browser can fetch - so the file is read at compile time and inlined.
//
// {@link loadImages} is the step that reads them, asynchronously and ahead of
// time, over whatever notion of "a file" the host has - and over every file the
// entry file imports as well, since an imported file draws its own images.

import { imageMediaType, isImageUrl } from '@axis-dsl/syntax';
import { findStatements, type ResolvedImport } from './imports';

/** An image file that was found: where it lives, and the URI it inlines as. */
export interface ResolvedImage {
    /** The file's identity, as the host names one. Reported as a dependency. */
    path: string;
    /** The whole `data:` URI, ready to hand Desmos as an image's URL. */
    dataUri: string;
}

/**
 * Resolve `url`, as written in the file at `from`, to a picture.
 *
 * Only ever asked about a path: a URL Desmos can load, `data:` URIs included,
 * reaches the graph exactly as it was written. Returning undefined means the
 * file could not be found, which the compiler reports against the statement.
 */
export type ResolveImage = (url: string, from: string) => ResolvedImage | undefined;

/**
 * Every image file `source` draws, in the order it draws them.
 *
 * Paths only - an `image` that already names a URL has no file behind it. Read
 * off the syntax tree, so an image inside a folder is found as readily as one
 * at the top level.
 */
export function findImageFiles(source: string): string[] {
    return findStatements(source, 'ImageStatement')
        .map(statement => statement.source.value)
        .filter(url => !isImageUrl(url));
}

/** How {@link loadImages} names and reads the host's image files. */
export interface ImageHost {
    /**
     * Turn `url`, as written in the file at `from`, into the path the file is
     * known by. The host owns what a path means, exactly as it does for an
     * import - and for the same reason, since the two are written alike.
     */
    resolve(url: string, from: string): string;
    /** Read a file named by {@link resolve}. Rejecting means it is not there. */
    read(path: string): Promise<Uint8Array>;
}

/**
 * Read every image file the entry file and its imports draw.
 *
 * The result is keyed by resolved path and is what {@link createImageResolver}
 * turns into the synchronous callback the compiler wants. `imported` is what
 * {@link loadImports} handed back, so one walk of the import graph serves both.
 *
 * A file that cannot be read, or is not a picture, is left out rather than
 * failing the load: the compiler reports it against the `image` statement that
 * names it, which is somewhere a user can be pointed.
 */
export async function loadImages(
    entry: ResolvedImport,
    imported: ReadonlyMap<string, string>,
    host: ImageHost,
): Promise<Map<string, string>> {
    const images = new Map<string, string>();

    const files: ResolvedImport[] = [
        entry,
        ...[...imported].map(([path, source]) => ({ path, source })),
    ];

    for (const file of files) {
        for (const url of findImageFiles(file.source)) {
            const path = host.resolve(url, file.path);
            const mediaType = imageMediaType(path);
            if (images.has(path) || mediaType === undefined) {
                continue;
            }

            try {
                const bytes = await host.read(path);
                images.set(path, `data:${mediaType};base64,${encodeBase64(bytes)}`);
            } catch {
                // Reported by the compiler, which cannot resolve it either.
            }
        }
    }

    return images;
}

/** A {@link ResolveImage} that reads from an already-loaded set of images. */
export function createImageResolver(
    images: ReadonlyMap<string, string>,
    resolve: ImageHost['resolve'],
): ResolveImage {
    return (url, from) => {
        const path = resolve(url, from);
        const dataUri = images.get(path);
        return dataUri === undefined ? undefined : { path, dataUri };
    };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The bytes of a file as base64.
 *
 * Written out rather than reached for, because the compiler runs in a browser
 * as readily as in Node and neither `Buffer` nor `btoa` is in both - and `btoa`
 * takes a string of code points, which is a byte array with a bug in it.
 */
function encodeBase64(bytes: Uint8Array): string {
    let encoded = '';

    for (let index = 0; index < bytes.length; index += 3) {
        const remaining = bytes.length - index;
        const triple =
            (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);

        encoded += BASE64_ALPHABET[(triple >> 18) & 63];
        encoded += BASE64_ALPHABET[(triple >> 12) & 63];
        encoded += remaining > 1 ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
        encoded += remaining > 2 ? BASE64_ALPHABET[triple & 63] : '=';
    }

    return encoded;
}
