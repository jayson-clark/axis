// ═════════════════════════════════════════════════════════════════════════════
// Links - the paths in a document that point somewhere
// ═════════════════════════════════════════════════════════════════════════════
//
// `import "./curves.axis"` and `image "./beach.png"` both name a file, and both
// are worth being able to open from the script that names them. Which file a
// path names is the host's to say, so what lives here is the finding: where
// each path sits, and what kind of thing it points at.

import type * as ast from '@axis-dsl/syntax';
import { spanToRange, toTree, type DocumentInput, type Range } from './document';
import { isImageUrl } from './paths';
import { allStatements } from './symbols';

/**
 * What a link points at, and so how a host turns it into an address.
 *
 * `import` and `image` name a file, resolved the way that statement resolves
 * one. `url` is an image that named an address instead, which opens as it is.
 */
export type DocumentLinkKind = 'import' | 'image' | 'url';

/** A path in the document, and where it is written. */
export interface DocumentLink {
    kind: DocumentLinkKind;
    /** The path or address as written, unescaped - what the host resolves. */
    target: string;
    /** The path itself, inside its quotes. */
    range: Range;
}

/**
 * Every path in the document that points somewhere, in document order - those
 * inside folders included.
 *
 * A `data:` image is left out: it carries its picture rather than naming one,
 * and a link to a hundred kilobytes of base64 opens nothing.
 */
export function getDocumentLinks(input: DocumentInput): DocumentLink[] {
    const tree = toTree(input);
    const links: DocumentLink[] = [];

    const inside = (literal: ast.StringLiteral) => {
        const text = tree.source.slice(literal.span.start, literal.span.end);
        // An unterminated string has no closing quote to leave out.
        const closed = text.length > 1 && text.endsWith('"');
        return spanToRange(tree, {
            start: literal.span.start + 1,
            end: literal.span.end - (closed ? 1 : 0),
        });
    };

    for (const statement of allStatements(tree.file.statements)) {
        if (statement.kind === 'ImportStatement') {
            links.push({
                kind: 'import',
                target: statement.path.value,
                range: inside(statement.path),
            });
        } else if (statement.kind === 'ImageStatement') {
            const target = statement.source.value;
            if (target.startsWith('data:')) continue;
            links.push({
                kind: isImageUrl(target) ? 'url' : 'image',
                target,
                range: inside(statement.source),
            });
        }
    }
    return links;
}
