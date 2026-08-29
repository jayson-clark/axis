// ═════════════════════════════════════════════════════════════════════════════
// Blocks - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════
//
// Axis has one rule for separating things: statements at the top level are
// separated by newlines, and entries inside a bracket are separated by commas.
// That holds however the brackets are laid out, so
//
//     table { x = [1, 2, 3], y = [1, 4, 9] }
//
// and the same table spread over four lines are the same script. This module is
// what makes the two equivalent: it cuts a line into the statements it actually
// contributes, tracking the blocks it opens and closes as it goes.
//
// The compiler uses it to flatten a script back to one statement per line; the
// diagnostics use it to find the entry that is missing its comma.

import { CLOSER_FOR, CLOSERS, endOfStringOrLine, matchingBracket, OPENERS } from './scan';

/** `folder "Name"`, `table` or `config`, as written immediately before a `{`. */
const BLOCK_HEADER = /^(?:folder\s+"(?:[^"\\]|\\[^])*"|table|config)$/;

/** The block keywords, for spotting a header that is missing its brace. */
export const BLOCK_KEYWORDS = /^(folder|table|config)\b(?!\s*=)/;

/**
 * What a bracket holds.
 *
 * `list` covers everything that is not a named block: a list, a piecewise, a
 * call split over several lines.
 */
export type BlockKind = 'folder' | 'table' | 'config' | 'list';

export interface BlockFrame {
    kind: BlockKind;
    /** The bracket that opened the block. */
    open: string;
    /** Zero-based line the block was opened on. */
    line: number;
    /** Column of the opening bracket. */
    index: number;
    /** The block this one sits inside, if any. */
    parent?: BlockFrame;
}

export type BlockSegmentKind = 'header' | 'entry' | 'close';

export interface BlockSegment {
    kind: BlockSegmentKind;
    /** The segment's text, trimmed. A header keeps its opening bracket. */
    text: string;
    /** Zero-based line the segment sits on. */
    line: number;
    /** Column of `text[0]`. */
    start: number;
    /** The block the segment sits directly inside, or undefined at the top level. */
    parent?: BlockFrame;
    /** For a header or a close, the block it opens or ends. */
    block?: BlockFrame;
    /** True when a comma follows the segment. */
    separated: boolean;
    /** True when the segment is only a comment, and so is not an entry. */
    comment: boolean;
}

/**
 * Cut one line into the statements it contributes.
 *
 * `stack` carries the blocks that are still open, and is updated in place, so
 * scanning a document means calling this for each line in turn with the same
 * array.
 *
 * A bracket that closes on the same line is opaque - the commas inside a
 * `(1, 2)` or a `{x < 0: 1, x >= 0: 2}` belong to that expression, not to the
 * block around it. Only a bracket left open, or a brace that follows a block
 * keyword, starts a block whose entries are split apart.
 */
export function scanBlockLine(
    line: string,
    lineNumber: number,
    stack: BlockFrame[],
): BlockSegment[] {
    const segments: BlockSegment[] = [];
    let buffer = '';
    let bufferStart = -1;

    const take = (text: string, index: number) => {
        if (bufferStart === -1 && text.trim()) {
            bufferStart = index + (text.length - text.trimStart().length);
        }
        buffer += text;
    };

    const flush = (
        kind: BlockSegmentKind = 'entry',
        block?: BlockFrame,
    ): BlockSegment | undefined => {
        const text = buffer.trim();
        const start = bufferStart;
        buffer = '';
        bufferStart = -1;

        if (!text) {
            return undefined;
        }

        const segment: BlockSegment = {
            kind,
            text,
            line: lineNumber,
            start,
            parent: stack[stack.length - 1],
            block,
            separated: false,
            // A `#` that opens a line is the blank row Desmos keeps for
            // spacing - properties and no expression. It compiles to one, but
            // it separates nothing, so the comma rules step over it the way
            // they step over a comment.
            comment: text.startsWith('//') || text.startsWith('#'),
        };
        segments.push(segment);
        return segment;
    };

    let i = 0;
    while (i < line.length) {
        const char = line[i];

        if (char === '"' || char === "'") {
            const end = endOfStringOrLine(line, i);
            take(line.slice(i, end), i);
            i = end;
            continue;
        }

        // A statement ends where its comment begins; the comment travels on as
        // a segment of its own so nothing downstream has to strip it.
        if (char === '/' && line[i + 1] === '/') {
            flush();
            take(line.slice(i), i);
            flush();
            break;
        }

        // `# key: value` annotates the statement it trails, which may already
        // have been flushed - `folder "A" { # collapsed: true` annotates the
        // folder, not the first entry inside it.
        if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
            const end = endOfMetadata(line, i, stack.length > 0);
            const metadata = line.slice(i, end);
            const previous = segments[segments.length - 1];
            if (buffer.trim() || !previous) {
                take(metadata, i);
            } else {
                previous.text = `${previous.text} ${metadata.trim()}`;
            }
            i = end;
            continue;
        }

        if (OPENERS.includes(char)) {
            const header = buffer.trim();
            const closeIndex = matchingBracket(line, i);
            const opensBlock =
                char === '{' && (BLOCK_HEADER.test(header) || line.slice(i + 1).trim() === '');

            if (!opensBlock && closeIndex !== -1) {
                take(line.slice(i, closeIndex + 1), i);
                i = closeIndex + 1;
                continue;
            }

            take(char, i);
            const frame: BlockFrame = {
                kind: blockKind(char, header),
                open: char,
                line: lineNumber,
                index: i,
                parent: stack[stack.length - 1],
            };
            flush('header', frame);
            stack.push(frame);
            i++;
            continue;
        }

        if (CLOSERS.includes(char)) {
            const frame = stack[stack.length - 1];
            if (frame && CLOSER_FOR[frame.open] === char) {
                flush();
                stack.pop();
                take(char, i);
                flush('close', frame);
                i++;
                continue;
            }
            // A closer with nothing open is left where it is; the diagnostics
            // report it, and the compiler ignores it.
            take(char, i);
            i++;
            continue;
        }

        if (char === ',' && stack.length > 0) {
            const separated = flush() ?? segments[segments.length - 1];
            if (separated) {
                separated.separated = true;
            }
            i++;
            continue;
        }

        take(char, i);
        i++;
    }

    flush();
    return segments;
}

/** Scan a whole document, returning every segment in document order. */
function scanBlockSegments(lines: string[]): BlockSegment[] {
    const stack: BlockFrame[] = [];
    const segments: BlockSegment[] = [];

    lines.forEach((line, index) => {
        segments.push(...scanBlockLine(line, index, stack));
    });

    return segments;
}

/**
 * The segments that ought to be followed by a comma but are not.
 *
 * An entry needs a separator unless it is the last one in its block - the comma
 * before a closing bracket is optional - and a nested block's `}` needs one just
 * as much as a plain entry does.
 *
 * A bracket that merely wrapped a statement over several lines is different:
 * `polygon(\n  …\n)for a = […]` closes its call and carries straight on, so
 * the comma belongs after the `for`, not after the `)`.
 */
export function missingSeparators(segments: BlockSegment[]): BlockSegment[] {
    // Comments sit between entries without being one, so they are dropped
    // before anything asks what follows what.
    const entries = segments.filter(segment => !segment.comment);
    const missing: BlockSegment[] = [];

    for (let i = 0; i < entries.length; i++) {
        const segment = entries[i];

        // A header is followed by its own contents, and a top-level statement
        // is separated by its newline.
        if (segment.kind === 'header' || !segment.parent || segment.separated) {
            continue;
        }

        const next = entries[i + 1];
        if (!next || next.kind === 'close') {
            continue;
        }

        // The rest of the statement the bracket was holding open, on the line
        // the bracket closed on. The separator it needs is that statement's.
        if (
            segment.kind === 'close' &&
            segment.block?.kind === 'list' &&
            next.line === segment.line
        ) {
            continue;
        }

        missing.push(segment);
    }

    return missing;
}

/** Write the commas {@link missingSeparators} finds back into `lines`. */
export function insertMissingSeparators(lines: string[]): string[] {
    const columns = new Map<number, number[]>();

    for (const segment of missingSeparators(scanBlockSegments(lines))) {
        const line = columns.get(segment.line) ?? [];
        line.push(segment.start + segment.text.length);
        columns.set(segment.line, line);
    }

    return lines.map((line, index) => {
        const insertions = columns.get(index);
        if (!insertions) {
            return line;
        }
        // Right to left, so an earlier insertion cannot shift a later column.
        return insertions
            .sort((a, b) => b - a)
            .reduce((text, at) => `${text.slice(0, at)},${text.slice(at)}`, line);
    });
}

/**
 * Rewrite `lines` with one statement per line, so a block written inline is
 * indistinguishable from the same block written out:
 *
 * ```
 * table { x = [1, 2], y = [1, 4] }   ->   table {
 *                                         x = [1, 2]
 *                                         y = [1, 4]
 *                                         }
 * ```
 *
 * Indentation is dropped, since the only consumer is the compiler, which trims.
 */
export function expandBlockEntries(lines: string[]): string[] {
    const stack: BlockFrame[] = [];
    const expanded: string[] = [];

    lines.forEach((line, index) => {
        const segments = scanBlockLine(line, index, stack);
        if (!segments.length) {
            // Blank lines carry no statement, but keeping them costs nothing
            // and leaves the output readable.
            expanded.push(line);
            return;
        }
        segments.forEach(segment => expanded.push(segment.text));
    });

    return expanded;
}

function blockKind(open: string, header: string): BlockKind {
    if (open !== '{') {
        return 'list';
    }
    if (/^folder\b/.test(header)) return 'folder';
    if (header === 'table') return 'table';
    if (header === 'config') return 'config';
    return 'list';
}

/**
 * Index just past the metadata run that starts at the `#` on `start`.
 *
 * Metadata is the last thing in a statement, so at the top level it simply runs
 * to the end of the line. Inside a block it has to give way to the block: the
 * `}` that closes the block around it ends it, and so does a comma that starts
 * something which is not a `key: value` property - that comma separates two
 * entries rather than two properties.
 */
function endOfMetadata(line: string, start: number, insideBlock: boolean): number {
    let depth = 0;

    for (let i = start + 1; i < line.length; i++) {
        const char = line[i];

        if (char === '"' || char === "'") {
            i = endOfStringOrLine(line, i) - 1;
        } else if (char === '/' && line[i + 1] === '/') {
            return i;
        } else if (OPENERS.includes(char)) {
            depth++;
        } else if (CLOSERS.includes(char)) {
            if (depth === 0) {
                return insideBlock ? i : line.length;
            }
            depth--;
        } else if (
            char === ',' &&
            depth === 0 &&
            insideBlock &&
            !startsMetadataProperty(line, i + 1)
        ) {
            return i;
        }
    }

    return line.length;
}

/** True when `key: value`, or a bare `hidden`/`secret` flag, starts at `from`. */
function startsMetadataProperty(line: string, from: number): boolean {
    const match = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(:|,|\}|\]|\)|$)/.exec(line.slice(from));
    if (!match) {
        return false;
    }
    return match[2] === ':' || match[1] === 'hidden' || match[1] === 'secret';
}
