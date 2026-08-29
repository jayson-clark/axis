// ═════════════════════════════════════════════════════════════════════════════
// Links - the paths in a document that point somewhere
// ═════════════════════════════════════════════════════════════════════════════
//
// `import "./curves.axis"` and `image "./beach.png"` both name a file, and both
// are worth being able to open from the script that names them. Which file a
// path names is the host's to say, exactly as it is for the diagnostics, so
// what lives here is the finding: where each path sits, and what kind of thing
// it points at.

import { findImageStatements, isImageUrl } from './images';
import { findImportStatements } from './imports';

/**
 * What a link points at, and so how a host turns it into an address.
 *
 * `import` and `image` name a file, resolved the way that statement resolves
 * one. `url` is an image that named an address instead, which opens as it is.
 */
export type AxisLinkKind = 'import' | 'image' | 'url';

/** A path in the document, and where it is written. */
export interface AxisLink {
    kind: AxisLinkKind;
    /** The path or address as written, unescaped - what the host resolves. */
    target: string;
    /** Zero-based line the path sits on. */
    line: number;
    /** Column the path itself starts at, inside its quotes. */
    startCharacter: number;
    /** Column just past its last character, before the closing quote. */
    endCharacter: number;
}

/**
 * Every path in `text` that points somewhere, in document order.
 *
 * A `data:` image is left out: it carries its picture rather than naming one,
 * and a link to a hundred kilobytes of base64 opens nothing.
 */
export function findAxisLinks(text: string): AxisLink[] {
    const links: AxisLink[] = [];

    for (const statement of findImportStatements(text)) {
        links.push({ kind: 'import', target: statement.specifier, ...inside(statement) });
    }

    for (const statement of findImageStatements(text)) {
        if (statement.url.startsWith('data:')) {
            continue;
        }

        links.push({
            kind: isImageUrl(statement.url) ? 'url' : 'image',
            target: statement.url,
            ...inside(statement),
        });
    }

    return links.sort((one, other) =>
        one.line === other.line ? one.startCharacter - other.startCharacter : one.line - other.line,
    );
}

/** The range a statement's quotes hold, which is the part worth underlining. */
function inside(statement: { line: number; startCharacter: number; endCharacter: number }) {
    return {
        line: statement.line,
        startCharacter: statement.startCharacter + 1,
        endCharacter: statement.endCharacter - 1,
    };
}
