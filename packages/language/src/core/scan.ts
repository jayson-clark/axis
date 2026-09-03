// ═════════════════════════════════════════════════════════════════════════════
// Scanning primitives - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════
//
// Nearly everything in `core/` needs the same thing from a line: read it left to
// right, ignoring anything inside a string or a `//` comment, and know how deep
// in brackets each character sits. The formatter needs it to indent, the
// diagnostics to pair brackets up, the metadata splitter to find the commas that
// separate entries rather than arguments.
//
// That walk lives here once, so a fix to how a quote or a comment is recognised
// reaches every caller at the same time.

/** Every opening bracket the language uses, in a fixed order. */
export const OPENERS = '([{';

/** Every closing bracket, in the order matching {@link OPENERS}. */
export const CLOSERS = ')]}';

export const CLOSER_FOR: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
export const OPENER_FOR: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** The closers matching an arbitrary subset of {@link OPENERS}. */
export function closersFor(openers: string): string {
    return [...openers].map(opener => CLOSER_FOR[opener]).join('');
}

/**
 * Index just past the string that starts at `start`.
 *
 * @returns the index after the closing quote, or -1 when the quote is never
 *          closed. {@link endOfStringOrLine} is the variant for callers that
 *          only want to skip past the text either way.
 */
export function endOfString(input: string, start: number): number {
    const quote = input[start];

    for (let i = start + 1; i < input.length; i++) {
        // A backslash spends the character after it, whatever it is, so the
        // quote in `"a \" b"` closes nothing.
        if (input[i] === '\\') {
            i++;
        } else if (input[i] === quote) {
            return i + 1;
        }
    }

    return -1;
}

/** {@link endOfString}, treating an unclosed quote as running to end of input. */
export function endOfStringOrLine(input: string, start: number): number {
    const end = endOfString(input, start);
    return end === -1 ? input.length : end;
}

export interface ScanOptions {
    /**
     * Which openers count as brackets. Anything left out is an ordinary
     * character - the formatter uses this to treat a block's `{` as structure
     * rather than as a bracket that continues the line.
     */
    openers?: string;
    /** Whether a `//` comment ends the scan. Defaults to true. */
    stopAtLineComment?: boolean;
}

/**
 * Visit every character of `input` that is not inside a string, in order.
 *
 * `depth` is how many brackets are still open *before* the character, so a `,`
 * at depth 0 separates entries while one at depth 1 belongs to whatever bracket
 * it sits in. Openers and closers are reported at the depth they change from.
 *
 * Return `true` from `visit` to stop the scan.
 *
 * @returns the depth reached, which for a full scan is the net number of
 *          brackets the input leaves open.
 */
export function scanCode(
    input: string,
    visit: (char: string, index: number, depth: number) => boolean | void = () => {},
    { openers = OPENERS, stopAtLineComment = true }: ScanOptions = {},
): number {
    const closers = closersFor(openers);
    let depth = 0;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (char === '"' || char === "'") {
            const end = endOfString(input, i);
            // An unclosed quote swallows the rest of the input.
            if (end === -1) {
                return depth;
            }
            i = end - 1;
            continue;
        }

        if (stopAtLineComment && char === '/' && input[i + 1] === '/') {
            return depth;
        }

        if (visit(char, i, depth) === true) {
            return depth;
        }

        if (openers.includes(char)) {
            depth++;
        } else if (closers.includes(char)) {
            depth--;
        }
    }

    return depth;
}

/**
 * Index of the bracket closing the one at `start`, or -1 if it stays open.
 *
 * The scan begins at `start`, so the opener there is what the depth is counted
 * from; a `//` comment before the closer means the bracket is left open.
 */
export function matchingBracket(input: string, start: number, options?: ScanOptions): number {
    let match = -1;

    scanCode(
        input.slice(start),
        (char, index, depth) => {
            if (depth === 1 && CLOSERS.includes(char)) {
                match = start + index;
                return true;
            }
        },
        options,
    );

    return match;
}

/** Index of `char` outside every bracket and quote, or -1. */
export function topLevelIndexOf(input: string, char: string, options?: ScanOptions): number {
    let found = -1;

    scanCode(
        input,
        (current, index, depth) => {
            if (current === char && depth <= 0) {
                found = index;
                return true;
            }
        },
        options,
    );

    return found;
}
