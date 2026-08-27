// ═════════════════════════════════════════════════════════════════════════════
// Bracket depth - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════

import { splitTrailingMetadata } from './metadata';
import { closersFor, OPENERS, scanCode } from './scan';

/**
 * Brackets a statement can be split across lines with.
 *
 * A brace opens a `folder`/`table`/`config`/piecewise block when it follows a
 * block keyword or is the last thing on its line, so those lines continue with
 * `(` and `[` alone; a brace opened mid-line is an ordinary piecewise or
 * constraint group and joins like any other bracket.
 */
const CONTINUATION_BRACKETS = '([';

/** A block keyword and its brace, as `folder "A" { y = x` opens one. */
const BLOCK_OPENER = /^(?:folder\s+"[^"]*"|table|config)\s*\{/;

/** Continuation brackets for `line`, braces included unless it opens a block. */
function continuationBracketsFor(code: string): string {
    return code.endsWith('{') || BLOCK_OPENER.test(code) ? CONTINUATION_BRACKETS : OPENERS;
}

/**
 * The net bracket depth `line` opens: positive when it leaves brackets unclosed,
 * negative when it closes more than it opens.
 *
 * Brackets inside strings and `//` comments do not count, so a note such as
 * `"an unmatched ( here"` does not swallow the lines after it.
 */
export function bracketDelta(line: string, openers: string = OPENERS): number {
    return scanCode(line, undefined, { openers });
}

/**
 * How many brackets `line` closes before it does anything else.
 *
 * These belong to the blocks being closed rather than to the line, so a
 * formatter de-indents by this much before writing it out. A closer further
 * along the line - `x >= 0: x^2}` - is not one of them: it only affects the
 * lines that follow.
 */
export function leadingClosers(line: string, openers: string = OPENERS): number {
    const closers = closersFor(openers);
    let count = 0;

    for (const char of line.trim()) {
        if (closers.includes(char)) {
            count++;
        } else if (!/\s/.test(char)) {
            break;
        }
    }

    return count;
}

/**
 * Join lines that continue an unclosed `(` or `[` onto the statement that opened
 * it, so a list, a call, or a table column can be written across several lines:
 *
 * ```
 * P = [
 *     (0,0),
 *     (4,0)
 * ]
 * ```
 *
 * Blank lines and indentation inside the brackets collapse to single spaces;
 * everything else is passed through untouched, and a bracket left unclosed at
 * end of input simply ends the statement.
 */
export function joinContinuedLines(text: string): string[] {
    const joined: string[] = [];
    let pending: string | undefined;
    let pendingMetadata: string[] = [];
    let depth = 0;

    const flush = () => {
        const metadata = pendingMetadata.length ? ` # ${pendingMetadata.join(', ')}` : '';
        joined.push(pending + metadata);
        pending = undefined;
        pendingMetadata = [];
    };

    for (const rawLine of text.split('\n')) {
        // Metadata is held back and re-attached once the statement closes, so
        // it can be written on any of the lines the statement spans and still
        // end up where the compiler looks for it.
        const { code, metadata } = splitTrailingMetadata(rawLine.trim());
        const delta = bracketDelta(code, continuationBracketsFor(code));

        if (pending === undefined) {
            if (delta <= 0) {
                joined.push(rawLine);
                continue;
            }
            pending = code;
            depth = delta;
        } else {
            depth += delta;
            if (code) {
                pending = `${pending} ${code}`;
            }
        }

        if (metadata) {
            pendingMetadata.push(metadata);
        }

        if (depth <= 0) {
            flush();
        }
    }

    if (pending !== undefined) {
        flush();
    }

    return joined;
}
