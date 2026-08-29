// ═════════════════════════════════════════════════════════════════════════════
// String escapes - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════
//
// A note, a folder's title and a quoted property value are all one quoted run
// on one line, because a statement in Axis is a line. A Desmos note is not so
// constrained: it holds newlines, and it holds quotes.
//
// Escapes are what let the two meet without giving the parser a string that
// spans lines - `\n` for a line break, `\"` for a quote, `\\` for a backslash
// that means itself.
//
// An escape nobody defined is left exactly as written. That is what keeps a
// note able to talk about LaTeX: `"\frac is a fraction"` says `\frac`, not `f`
// followed by the rest, and a script written before any of this existed reads
// the same as it always did.

/** What a recognised escape stands for. */
const CHARACTER_FOR: Record<string, string> = {
    n: '\n',
    t: '\t',
    r: '\r',
    '"': '"',
    "'": "'",
    '\\': '\\',
};

/** The escape that writes each character. The reverse of {@link CHARACTER_FOR}. */
const ESCAPE_FOR: Record<string, string> = {
    '\n': '\\n',
    '\t': '\\t',
    '\r': '\\r',
    '"': '\\"',
    '\\': '\\\\',
};

/**
 * The text a quoted run stands for, escapes resolved. The quotes themselves are
 * not part of `body`.
 */
export function unescapeString(body: string): string {
    // `[^]` rather than `.` so an escaped newline is matched too, and the whole
    // match is the fallback so an unknown escape keeps its backslash.
    return body.replace(/\\([^]?)/g, (escape, char: string) => CHARACTER_FOR[char] ?? escape);
}

/** `text` as the body of a quoted run: the inverse of {@link unescapeString}. */
export function escapeString(text: string): string {
    return text.replace(/[\\"\n\t\r]/g, char => ESCAPE_FOR[char]);
}
