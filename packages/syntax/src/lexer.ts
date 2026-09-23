// ═════════════════════════════════════════════════════════════════════════════
// The lexer
// ═════════════════════════════════════════════════════════════════════════════
//
// Source text in, every token out - trivia included, so that concatenating the
// tokens' text gives back the source exactly (spec §2.1). Nothing downstream
// has to keep its own copy of the spacing or the comments: they are here, in
// order, with their spans.
//
// Lexing never fails. Anything it cannot read becomes an `error` token with a
// diagnostic beside it, and reading carries on at the next character, because
// an editor lexes every keystroke and a half-typed string must not take the
// rest of the file down with it.

import type { Diagnostic } from './ast';
import type { SyntaxDiagnosticCode } from './diagnostics';
import { KEYWORDS, type Token, type TokenKind } from './tokens';

export interface LexResult {
    tokens: Token[];
    diagnostics: Diagnostic<SyntaxDiagnosticCode>[];
}

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

/**
 * Punctuation, longest first, so that `...` is tried before `..` and `..`
 * before `.`, and `->` before `-`. `@{` is here as one token and only matches
 * with nothing between the two characters, which is the spec's rule.
 */
const PUNCTUATION = [
    '...',
    '..',
    '->',
    '<=',
    '>=',
    '@{',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    ',',
    ';',
    ':',
    '.',
    '=',
    '<',
    '>',
    '+',
    '-',
    '*',
    '/',
    '^',
    '!',
    '|',
    '@',
] as const;

const isDigit = (c: string) => c >= '0' && c <= '9';
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isAlphanumeric = (c: string) => isLetter(c) || isDigit(c);
const isHexDigit = (c: string) => isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isWhitespace = (c: string) => c === ' ' || c === '\t' || c === '\r';

/** Whether a character could begin some token, so a run of junk knows where to stop. */
function startsToken(source: string, at: number): boolean {
    const c = source[at];
    return (
        isWhitespace(c) ||
        c === '\n' ||
        c === '"' ||
        c === '#' ||
        isAlphanumeric(c) ||
        PUNCTUATION.some(p => source.startsWith(p, at))
    );
}

export function lex(source: string): LexResult {
    const tokens: Token[] = [];
    const diagnostics: Diagnostic<SyntaxDiagnosticCode>[] = [];
    let at = 0;

    const push = (kind: TokenKind, end: number) => {
        tokens.push({ kind, text: source.slice(at, end), span: { start: at, end } });
        at = end;
    };

    const report = (code: SyntaxDiagnosticCode, message: string, start: number, end: number) => {
        diagnostics.push({ code, severity: 'error', message, span: { start, end } });
    };

    while (at < source.length) {
        const c = source[at];

        if (c === '\n') {
            push('newline', at + 1);
            continue;
        }

        if (isWhitespace(c)) {
            let end = at + 1;
            while (end < source.length && isWhitespace(source[end])) end++;
            push('whitespace', end);
            continue;
        }

        // A comment runs to the end of the line but not over it: the newline is
        // a token of its own, because it ends the statement the comment trails.
        if (source.startsWith('//', at)) {
            let end = at + 2;
            while (end < source.length && source[end] !== '\n') end++;
            // Nor over the `\r` of a Windows line ending, which is whitespace
            // like any other and not part of what the comment says.
            if (source[end - 1] === '\r' && end - 1 > at + 1) end--;
            push('comment', end);
            continue;
        }

        if (c === '"') {
            push('string', scanString(source, at, report));
            continue;
        }

        if (c === '#') {
            // Read the whole word after the `#` before judging it, so that
            // `#ff00` is reported as one bad colour rather than as a colour
            // that stopped short and an identifier after it.
            let end = at + 1;
            while (end < source.length && isAlphanumeric(source[end])) end++;
            const digits = source.slice(at + 1, end);
            if ((digits.length === 3 || digits.length === 6) && [...digits].every(isHexDigit)) {
                push('color', end);
            } else {
                report(
                    'invalid-color',
                    `\`${source.slice(at, end)}\` is not a colour: write \`#\` and 3 or 6 hex digits`,
                    at,
                    end,
                );
                push('error', end);
            }
            continue;
        }

        if (isDigit(c) || (c === '.' && isDigit(source[at + 1] ?? ''))) {
            push('number', scanNumber(source, at));
            continue;
        }

        if (isLetter(c)) {
            let end = at + 1;
            while (end < source.length && isAlphanumeric(source[end])) end++;
            // An explicit subscript: `x_1`, `v_max` - only when something
            // follows the underscore, so `x_` is `x` and a stray `_`. More than
            // one is read too, because Desmos spells an enum value that way
            // (`LOOP_FORWARD_REVERSE`); in an expression, where a name has one
            // subscript at most, the checker says so.
            while (source[end] === '_' && isAlphanumeric(source[end + 1] ?? '')) {
                end += 2;
                while (end < source.length && isAlphanumeric(source[end])) end++;
            }
            push(KEYWORD_SET.has(source.slice(at, end)) ? 'keyword' : 'identifier', end);
            continue;
        }

        const punctuation = PUNCTUATION.find(p => source.startsWith(p, at));
        if (punctuation) {
            push('punctuation', at + punctuation.length);
            continue;
        }

        // Nothing we know. A run of it is one error rather than one per
        // character, so a pasted line of prose is one complaint, not forty.
        let end = at + 1;
        while (end < source.length && !startsToken(source, end)) end++;
        report(
            'unexpected-character',
            `Unexpected ${end - at === 1 ? 'character' : 'characters'} \`${source.slice(at, end)}\``,
            at,
            end,
        );
        push('error', end);
    }

    tokens.push({ kind: 'eof', text: '', span: { start: at, end: at } });
    return { tokens, diagnostics };
}

/**
 * `3`, `0.5`, `.5`, `1e-3`.
 *
 * A fraction needs a digit after its point, so `1..5` is `1`, `..`, `5` and
 * `1...10` is `1`, `...`, `10` - the ranges would be unwritable otherwise. An
 * exponent needs one too, so `2e` stays the product of 2 and Euler's number.
 */
function scanNumber(source: string, start: number): number {
    let end = start;
    while (isDigit(source[end] ?? '')) end++;
    if (source[end] === '.' && isDigit(source[end + 1] ?? '')) {
        end++;
        while (isDigit(source[end] ?? '')) end++;
    }
    if (source[end] === 'e') {
        const sign = source[end + 1] === '-' ? 1 : 0;
        if (isDigit(source[end + 1 + sign] ?? '')) {
            end += 1 + sign;
            while (isDigit(source[end] ?? '')) end++;
        }
    }
    return end;
}

/**
 * A string, from its opening quote to the end of its closing one.
 *
 * Strings never run over a line: one left open at the end of a line is closed
 * there, with an error, so the next line still reads as the statement it is.
 */
function scanString(
    source: string,
    start: number,
    report: (code: SyntaxDiagnosticCode, message: string, start: number, end: number) => void,
): number {
    let end = start + 1;
    while (end < source.length) {
        const c = source[end];
        if (c === '"') return end + 1;
        if (c === '\n') break;
        if (c === '\\') {
            const escaped = source[end + 1];
            if (escaped === undefined || escaped === '\n') {
                end++;
                break;
            }
            if (escaped !== '"' && escaped !== '\\' && escaped !== 'n') {
                report(
                    'invalid-escape',
                    `\`\\${escaped}\` is not an escape: a string knows \`\\"\`, \`\\\\\` and \`\\n\``,
                    end,
                    end + 2,
                );
            }
            end += 2;
            continue;
        }
        end++;
    }
    report('unterminated-string', 'This string is never closed', start, end);
    return end;
}

/**
 * The value a string token spells: its quotes off and its escapes read.
 *
 * Forgiving, because the lexer has already reported whatever is wrong with the
 * token: a missing closing quote is simply absent, and an escape it does not
 * know stands for the character after the backslash.
 */
export function unescapeString(text: string): string {
    // Closed only if the last quote is not itself escaped: an even run of
    // backslashes before it.
    const backslashes = text.length - 1 - text.slice(0, -1).replace(/\\+$/, '').length;
    const closed = text.length >= 2 && text.endsWith('"') && backslashes % 2 === 0;
    const body = closed ? text.slice(1, -1) : text.slice(1);
    return body.replace(/\\([^])?/g, (_, escaped: string | undefined) =>
        escaped === 'n' ? '\n' : (escaped ?? ''),
    );
}
