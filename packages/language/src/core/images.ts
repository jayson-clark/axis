// ═════════════════════════════════════════════════════════════════════════════
// Image statements - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════
//
// `image "…"` carries a picture. What it names may be a URL Desmos can fetch,
// a `data:` URI it can read on the spot, or - like an import - a file beside
// the script, which the compiler turns into a data URI before Desmos ever sees
// it. Only the syntax and the difference between those cases live here; reading
// the file is the compiler's host's business.

import { scanBlockLine, type BlockFrame } from './blocks';
import { splitTrailingMetadata } from './metadata';
import { unescapeString } from './strings';

/** An `image "…"` statement, as written. */
export interface ImageStatement {
    /** The URL or path as written, unescaped, before anything resolves it. */
    url: string;
}

/** An image statement, and where in the document its URL is written. */
export interface LocatedImage extends ImageStatement {
    /** Zero-based line the statement sits on. */
    line: number;
    /** Column of the URL's opening quote. */
    startCharacter: number;
    /** Column just past its closing quote. */
    endCharacter: number;
}

/**
 * `image "./beach.png"`, and nothing else on the line.
 *
 * The URL is the one part of the statement that cannot be written unquoted, so
 * everything else an image carries is its metadata rather than its syntax.
 */
const IMAGE_STATEMENT = /^image\s+"((?:[^"\\]|\\[^])*)"$/;

/**
 * True when a statement opens an image, however it goes on.
 *
 * The quote is part of the test, not just the keyword: what an image carries is
 * always a quoted URL, so `image = 5` is a variable somebody named `image` and
 * is left to compile as one.
 */
export const IMAGE_KEYWORD = /^image\s+["']/;

/** Read an image statement, or undefined when `code` is not a well-formed one. */
export function parseImageStatement(code: string): ImageStatement | undefined {
    const match = IMAGE_STATEMENT.exec(code.trim());
    return match ? { url: unescapeString(match[1]) } : undefined;
}

/**
 * Every image in `text`, with the URL each one names underlined.
 *
 * Scanned the way the compiler reads the document, so an image written inline
 * inside a folder is found as readily as one on a line of its own - and the
 * range covers the URL rather than the whole statement, since the URL is the
 * part a host has anything to say about.
 */
export function findImageStatements(text: string): LocatedImage[] {
    const found: LocatedImage[] = [];
    const stack: BlockFrame[] = [];

    text.split('\n').forEach((line, number) => {
        for (const segment of scanBlockLine(line, number, stack)) {
            if (segment.comment) {
                continue;
            }

            const code = splitTrailingMetadata(segment.text).code;
            const statement = parseImageStatement(code);
            if (!statement) {
                continue;
            }

            // The first quote in the statement opens the URL: `image` itself
            // holds nothing that could be mistaken for one.
            const quote = code.indexOf('"');
            const startCharacter = segment.start + quote;
            found.push({
                ...statement,
                line: segment.line,
                startCharacter,
                // Measured on the line rather than from the URL's length: the
                // written form carries escapes the parsed one has dropped.
                endCharacter: segment.start + code.lastIndexOf('"') + 1,
            });
        }
    });

    return found;
}

/**
 * True when `url` is something Desmos can already load: an address it fetches,
 * or a `data:` URI it reads. Anything else is a path, and names a file next to
 * the script the way an import does.
 */
export function isImageUrl(url: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/** The media type a data URI carries, by the file's extension. */
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
 * What an image file at `path` holds, by its extension.
 *
 * Undefined for an extension that is not an image's, which is how a script
 * that points `image` at a `.txt` is caught before a browser has to decide
 * what to make of it.
 */
export function imageMediaType(path: string): string | undefined {
    const dot = path.lastIndexOf('.');
    return dot === -1 ? undefined : MEDIA_TYPES[path.slice(dot + 1).toLowerCase()];
}
