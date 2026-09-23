// ═════════════════════════════════════════════════════════════════════════════
// Files - what the path in an `import` or an `image` names
// ═════════════════════════════════════════════════════════════════════════════
//
// A path is a string to the parser, but the language says more about it than
// that (spec §7): `.axis` may be left off an import, the folder an import lands
// in is named after its file, and an image is either a URL Desmos can already
// load or a picture beside the script, known by its extension. The compiler,
// the language service, the language server, the harness and the extension all
// have to agree on every one of those, so they live here, at the bottom of the
// stack, where each of them can reach the one copy.

/** The extension an Axis script is saved with. */
export const AXIS_FILE_EXTENSION = '.axis';

/** `./curves` names `./curves.axis`: the extension may be left off an import (spec §7). */
export function withAxisExtension(specifier: string): string {
    return specifier.endsWith(AXIS_FILE_EXTENSION)
        ? specifier
        : `${specifier}${AXIS_FILE_EXTENSION}`;
}

/**
 * The folder title an import takes when it does not give one: the file's name,
 * without its directory or its `.axis`.
 */
export function importTitle(path: string): string {
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    return name.endsWith(AXIS_FILE_EXTENSION) ? name.slice(0, -AXIS_FILE_EXTENSION.length) : name;
}

/**
 * True when `url` is something Desmos can already load: an address it fetches,
 * or a `data:` URI it reads. Anything else is a path, and names a file next to
 * the script the way an import does.
 */
export function isImageUrl(url: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/** The media type a picture file holds, by its extension. */
const MEDIA_TYPES: Record<string, string> = {
    apng: 'image/apng',
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    ico: 'image/x-icon',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
};

/** The image file extensions Axis knows how to read, without their dots. */
export const AXIS_IMAGE_EXTENSIONS = Object.keys(MEDIA_TYPES);

/**
 * What an image file at `path` holds, by its extension, or undefined for an
 * extension that is not a picture's.
 */
export function imageMediaType(path: string): string | undefined {
    const dot = path.lastIndexOf('.');
    return dot === -1 ? undefined : MEDIA_TYPES[path.slice(dot + 1).toLowerCase()];
}
