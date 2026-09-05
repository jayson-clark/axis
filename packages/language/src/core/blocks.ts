// ═════════════════════════════════════════════════════════════════════════════
// Blocks - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════
//
// Axis has one rule for separating things: a statement ends at the newline
// after it, wherever it is written. A block is no different from the top level
// in that respect - the entries of a `folder`, a `table`, a `config` or a
// `#{ … }` metadata block are separated by their newlines - so a comma is only
// needed between two entries written on the same line:
//
//     table { x = [1, 2, 3], y = [1, 4, 9] }
//
// and the same table spread over four commaless lines are the same script. An
// ordinary bracket is the exception: a newline inside a `(` or a `[` continues
// the statement rather than ending it, so its entries always take their commas.
//
// This module is what makes the layouts equivalent: it cuts a line into the
// statements it actually contributes, tracking the blocks it opens and closes
// as it goes. The compiler uses it to flatten a script back to one statement
// per line; the diagnostics use it to find the entry that is missing its
// comma.

import { CLOSER_FOR, CLOSERS, endOfStringOrLine, matchingBracket, OPENERS, scanCode } from './scan';

/** `folder "Name"`, `table` or `config`, as written immediately before a `{`. */
const BLOCK_HEADER = /^(?:folder\s+"(?:[^"\\]|\\[^])*"|table|config)$/;

/** The block keywords, for spotting a header that is missing its brace. */
export const BLOCK_KEYWORDS = /^(folder|table|config)\b(?!\s*=)/;

/**
 * What a bracket holds.
 *
 * `metadata` is a `#{ … }` block, whose entries are properties rather than
 * statements. `list` covers everything that is not a named block: a list, a
 * piecewise, a call split over several lines.
 */
export type BlockKind = 'folder' | 'table' | 'config' | 'metadata' | 'list';

export interface BlockFrame {
    kind: BlockKind;
    /**
     * The segment that opened the block, as it was written: `folder "A" {`, or
     * the statement a `#{` annotates. Set as the header is flushed, so anything
     * reading it from inside the block sees the whole of it.
     */
    header?: string;
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
    /** Column of that comma, when there is one. */
    separatorIndex?: number;
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
        if (kind === 'header' && block) {
            block.header = text;
        }

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

        // `#{` opens a metadata block, which holds the same properties a
        // trailing `# key: value` run does with the newlines of a block to
        // separate them. The header keeps its `#{` so that what it annotates -
        // the statement before it, or nothing at all - is still readable off it.
        if (
            char === '#' &&
            line[i + 1] === '{' &&
            (i === 0 || /\s/.test(line[i - 1])) &&
            stack[stack.length - 1]?.kind !== 'metadata'
        ) {
            take('#{', i);
            const frame: BlockFrame = {
                kind: 'metadata',
                open: '{',
                line: lineNumber,
                index: i + 1,
                parent: stack[stack.length - 1],
            };
            flush('header', frame);
            stack.push(frame);
            i += 2;
            continue;
        }

        // `# key: value` annotates the statement it trails, which may already
        // have been flushed - `folder "A" { # collapsed: true` annotates the
        // folder, not the first entry inside it.
        //
        // Inside a metadata block there is no metadata left to open: a `#`
        // there is the one a hex colour is written with.
        if (
            char === '#' &&
            (i === 0 || /\s/.test(line[i - 1])) &&
            stack[stack.length - 1]?.kind !== 'metadata'
        ) {
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
                separated.separatorIndex = i;
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

/**
 * Which of `lines` sit inside a `#{ … }` block.
 *
 * True for the property lines and the `}` that ends them, false for the line
 * the `#{` was opened on - that one is still the statement it annotates. The
 * formatter uses it to space a line as a property rather than as an expression.
 */
export function metadataBlockLines(lines: string[]): boolean[] {
    const stack: BlockFrame[] = [];

    return lines.map((line, index) => {
        // Read before the line is scanned, so a `#{` the line opens does not
        // claim the line that opened it.
        const inside = stack.some(frame => frame.kind === 'metadata');
        scanBlockLine(line, index, stack);
        return inside;
    });
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
 * A block's entries are separated the way top-level statements are, by the
 * newline between them, so the only entry that needs a comma is one with
 * another written after it on the same line. The comma before a closing bracket
 * is optional, as is the one before a nested block's `}`.
 *
 * An ordinary bracket does not work that way. A newline inside a `(` or a `[`
 * continues the statement the bracket belongs to rather than ending it - which
 * is what lets a list be written down the page - so there is no newline there
 * to separate anything, and every entry but the last needs its comma.
 *
 * A bracket that merely wrapped a statement over several lines is different
 * again: `polygon(\n  …\n)for a = […]` closes its call and carries straight on,
 * so the comma belongs after the `for`, not after the `)`.
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

        // Two entries on two lines are separated by the newline between them,
        // in a block just as at the top level. Inside an ordinary bracket that
        // newline is a continuation instead, and separates nothing.
        if (segment.parent.kind !== 'list' && next.line !== segment.line) {
            continue;
        }

        // The rest of the statement the bracket was holding open, on the line
        // the bracket closed on. The separator it needs is that statement's.
        if (
            segment.kind === 'close' &&
            segment.block?.kind === 'list' &&
            next.line === segment.line &&
            !opensStatement(next.text)
        ) {
            continue;
        }

        missing.push(segment);
    }

    return missing;
}

/**
 * Whether `text` reads as a statement of its own rather than as the rest of the
 * one a bracket was holding open.
 *
 * A continuation carries on from where the bracket closed - `) + 1`, or the
 * `)for a = […]` that binds the names a comprehension runs over, which brings
 * an `=` of its own with it. Anything else that assigns has started something
 * new, and the comma between the two is missing.
 */
function opensStatement(text: string): boolean {
    if (/^(?:for|with)(?![a-zA-Z0-9_])/.test(text)) {
        return false;
    }

    let assigns = false;

    scanCode(text, (char, index, depth) => {
        if (
            char === '=' &&
            depth <= 0 &&
            !'<>=!'.includes(text[index - 1]) &&
            text[index + 1] !== '='
        ) {
            assigns = true;
            return true;
        }
    });

    return assigns;
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
 * Collapse every `#{ … }` block onto the statement it annotates, so that what
 * reads the metadata only ever has to read one line of it:
 *
 * ```
 * y = sin(x) #{          ->   y = sin(x) # color: #c74440, lineWidth: 3
 *     color: #c74440
 *     lineWidth: 3
 * }
 * ```
 *
 * Properties are separated by their newlines, like the entries of any other
 * block, and by commas where two are written on one line - so the fold puts a
 * comma between every pair on the way past. A `#{` that opens a line of its own
 * annotates nothing and stays that way: it is the blank row Desmos keeps for
 * spacing, written with room for its properties.
 *
 * This is the first pass over a script, before the one that joins a statement
 * split across brackets: that pass runs lines together with a space, which
 * between two properties would lose the separator this one puts in.
 */
export function foldMetadataBlocks(text: string): string {
    const folded: string[] = [];
    /** The statement the open block annotates, or undefined outside one. */
    let head: string | undefined;
    let entries: string[] = [];
    let buffer = '';
    let depth = 0;

    const takeEntry = () => {
        if (buffer.trim()) {
            entries.push(buffer.trim());
        }
        buffer = '';
    };

    /** Write the block back onto its statement, with `rest` following it. */
    const closeBlock = (rest: string) => {
        takeEntry();
        const metadata = entries.length ? ` # ${entries.join(', ')}` : '';
        const line = `${head}${metadata}${rest}`.trimEnd();
        folded.push(head ? line : line.trimStart());
        head = undefined;
        entries = [];
    };

    for (const line of text.split('\n')) {
        let i = 0;

        if (head === undefined) {
            const open = openingHash(line);
            if (open === -1) {
                folded.push(line);
                continue;
            }
            head = line.slice(0, open).trimEnd();
            depth = 1;
            i = open + 2;
        }

        let closed = -1;
        for (; i < line.length; i++) {
            const char = line[i];

            if (char === '"' || char === "'") {
                const end = endOfStringOrLine(line, i);
                buffer += line.slice(i, end);
                i = end - 1;
            } else if (char === '/' && line[i + 1] === '/') {
                // A comment runs to the end of the line and annotates nothing.
                break;
            } else if (OPENERS.includes(char)) {
                depth++;
                buffer += char;
            } else if (CLOSERS.includes(char)) {
                depth--;
                if (depth === 0) {
                    closed = i;
                    break;
                }
                buffer += char;
            } else if (char === ',' && depth === 1) {
                takeEntry();
            } else {
                buffer += char;
            }
        }

        if (closed === -1) {
            // The newline ends this property the way a comma would - unless it
            // falls inside a `{…}` the property is written as, which is a value
            // rather than a block, and separates its parts with commas like any
            // other bracket.
            if (depth === 1) {
                takeEntry();
            } else {
                buffer += ' ';
            }
            continue;
        }

        closeBlock(line.slice(closed + 1));
    }

    // A block left open runs to the end of the file; the diagnostics report the
    // brace, and the properties it did hold are still read.
    if (head !== undefined) {
        closeBlock('');
    }

    return folded.join('\n');
}

/** Column of the `#` of a `#{` that opens a metadata block on `line`, or -1. */
function openingHash(line: string): number {
    let at = -1;

    scanCode(line, (char, index) => {
        if (
            char === '#' &&
            line[index + 1] === '{' &&
            (index === 0 || /\s/.test(line[index - 1]))
        ) {
            at = index;
            return true;
        }
    });

    return at;
}

/**
 * Take out the commas a block's entries no longer need: the ones at the end of
 * a line, where the newline already separates what follows.
 *
 * The inverse of {@link insertMissingSeparators}, and formatting runs both, so
 * that a block written either way comes back written one way. A comma inside an
 * ordinary bracket is left where it is, being the only separator there.
 */
export function removeRedundantSeparators(lines: string[]): string[] {
    const columns = new Map<number, number[]>();

    for (const segment of scanBlockSegments(lines)) {
        const at = segment.separatorIndex;

        if (
            at === undefined ||
            !segment.parent ||
            segment.parent.kind === 'list' ||
            // Anything after the comma on the line is what it separates this
            // entry from, and it is doing its job.
            lines[segment.line].slice(at + 1).trim() !== ''
        ) {
            continue;
        }

        const line = columns.get(segment.line) ?? [];
        line.push(at);
        columns.set(segment.line, line);
    }

    return lines.map((line, index) => {
        const removals = columns.get(index);
        if (!removals) {
            return line;
        }
        // Right to left, so an earlier removal cannot shift a later column.
        return removals
            .sort((a, b) => b - a)
            .reduce((text, at) => text.slice(0, at) + text.slice(at + 1), line);
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
 *
 * Metadata blocks are expected to have been folded away by
 * {@link foldMetadataBlocks} first; a `#{` still open here is cut into
 * properties the compiler has no statement to hang on.
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
