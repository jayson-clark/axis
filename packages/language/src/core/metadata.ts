// ═════════════════════════════════════════════════════════════════════════════
// Trailing metadata - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════

import { scanCode } from './scan';

export interface SplitLine {
    /** The line with its trailing metadata removed. */
    code: string;
    /** The `key: value, key: value` text, or undefined when there is none. */
    metadata: string | undefined;
}

/**
 * Split a line's trailing `# key: value` metadata off the expression it
 * annotates.
 *
 * A `#` that is not followed by `key: value` (or a bare `hidden`/`secret` flag)
 * is left alone: `y = x # ff0000` reads as a hex colour or a stray comment
 * rather than as metadata.
 */
export function splitTrailingMetadata(line: string): SplitLine {
    let hash = -1;

    // A `#` inside a string is text - a note that mentions one, a label that is
    // one - so the scan skips over quoted runs rather than taking the first
    // `#` on the line.
    scanCode(line, (char, index) => {
        if (char === '#' && index > 0 && /\s/.test(line[index - 1])) {
            hash = index;
            return true;
        }
    });

    if (hash === -1) {
        return { code: line, metadata: undefined };
    }

    const metadata = line.slice(hash + 1).trim();
    if (!metadata.includes(':') && metadata !== 'hidden' && metadata !== 'secret') {
        return { code: line, metadata: undefined };
    }

    return { code: line.slice(0, hash).trim(), metadata };
}

/** One piece of a top-level split, with the column it starts at in the input. */
export interface TopLevelPart {
    text: string;
    /** Offset of `text[0]` within the string that was split. */
    start: number;
}

/**
 * Split on `separator`, ignoring separators nested in brackets or quotes.
 *
 * Entry lists are not always separator-free - `onClick: a -> (x, y)` holds a
 * comma that does not start a new property.
 */
export function splitTopLevelParts(input: string, separator: string): TopLevelPart[] {
    const parts: TopLevelPart[] = [];
    let start = 0;

    // An entry list is not a statement, so a `//` inside one is ordinary text.
    scanCode(
        input,
        (char, index, depth) => {
            if (char === separator && depth <= 0) {
                parts.push({ text: input.slice(start, index), start });
                start = index + 1;
            }
        },
        { stopAtLineComment: false },
    );

    parts.push({ text: input.slice(start), start });
    return parts;
}

/** {@link splitTopLevelParts} when only the pieces themselves are needed. */
export function splitTopLevel(input: string, separator: string): string[] {
    return splitTopLevelParts(input, separator).map(part => part.text);
}
