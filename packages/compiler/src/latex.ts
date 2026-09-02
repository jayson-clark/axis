// ═════════════════════════════════════════════════════════════════════════════
// Axis expressions to Desmos LaTeX
// ═════════════════════════════════════════════════════════════════════════════
//
// A rewriting pipeline, not a parser. Each step below assumes the ones before it
// have run, so the order is the design: braces are converted first, while the
// only braces present are the author's; names become subscripts before functions
// become commands, so `\sin` is never mistaken for a variable called `sin`.
//
// The tables and patterns every step needs are built once, at module load. The
// compiler runs this per expression, which on a live preview means per keystroke.

import {
    AXIS_CONSTANT_NAMES,
    AXIS_FUNCTION_NAMES,
    AXIS_LATEX_FOR_CONSTANT,
    AXIS_OPERATOR_NAMES,
    getFunctionLatex,
} from '@axis-dsl/language';

/** Every name the language defines, so the subscript rule leaves them alone. */
const BUILT_IN_NAMES = new Set([
    ...AXIS_FUNCTION_NAMES,
    ...AXIS_CONSTANT_NAMES,
    ...AXIS_OPERATOR_NAMES,
]);

/**
 * What may not come before a name being recognised.
 *
 * Not `\b`: a word boundary also refuses to open a name after a digit, and
 * `3cos(t)` is a coefficient times a cosine — the way anybody writes it, and
 * the way Desmos reads it. A letter before the name is different, since
 * `xcos(t)` is one identifier, so only letters block the match.
 */
const NOT_AFTER_NAME = '(?<![a-zA-Z_])';

/**
 * `alpha2` → `\alpha_{2}`: a constant with a LaTeX form, carrying a suffix.
 *
 * Only constants that survive to become commands are listed - matching `e`
 * against `epsilon` would otherwise split a constant into `\e_{psilon}`.
 * Longest first for the same reason, and the whole word is checked against the
 * constant list so `eta` is not read as `e` + `ta`.
 */
const CONSTANT_PREFIX_PATTERNS = [...AXIS_LATEX_FOR_CONSTANT].map(([name, latex]) => ({
    pattern: new RegExp(`${NOT_AFTER_NAME}${name}([a-zA-Z0-9]+)\\b`, 'g'),
    latex,
}));

/** `sin` → `\sin`, longest first so `arcsin` is not clipped to `arc` + `sin`. */
const FUNCTION_PATTERNS = AXIS_FUNCTION_NAMES.map(name => ({
    pattern: new RegExp(`${NOT_AFTER_NAME}${name}(?=\\s*\\\\left\\(|\\s|$)`, 'g'),
    latex: getFunctionLatex(name),
}));

/** `pi` → `\pi`, for a constant standing on its own. */
const CONSTANT_PATTERNS = [...AXIS_LATEX_FOR_CONSTANT].map(([name, latex]) => ({
    pattern: new RegExp(`${NOT_AFTER_NAME}${name}\\b`, 'g'),
    latex,
}));

/**
 * `width` → `\operatorname{width}`, and `for` likewise.
 *
 * Only the whole word: unlike a constant, an operator that opens a longer name
 * is not that operator carrying a subscript, so `heightMap` stays the variable
 * it looks like.
 */
const OPERATOR_PATTERNS = AXIS_OPERATOR_NAMES.map(name => ({
    pattern: new RegExp(`${NOT_AFTER_NAME}${name}(?![a-zA-Z0-9_])`, 'g'),
    latex: `\\operatorname{${name}}`,
}));

/**
 * Convert an Axis expression into the LaTeX Desmos expects:
 * - Braces: `{` `}` → `\left\{` `\right\}` (piecewise, lists, constraints)
 * - Division: `a/b` → `\frac{a}{b}`
 * - Multiplication: `*` → `\cdot`
 * - Parentheses: `(` `)` → `\left(` `\right)`
 * - Roots: `sqrt(x)` → `\sqrt{x}`, `nthroot(x, 3)` → `\sqrt[3]{x}`
 * - Absolute value bars: `|x|` → `\left|x\right|`
 * - Multi-letter names: `abc` → `a_{bc}`
 * - Built-in functions: `sin` → `\sin`, `mean` → `\operatorname{mean}`
 * - Greek letters and constants: `pi` → `\pi`, `infinity` → `\infty`
 * - Bare operators: `width` → `\operatorname{width}`, `for` likewise
 * - Inequalities: `<=`, `>=` → `\le`, `\ge`
 * - Action arrow: `->` → `\to`
 */
export function convertToLatex(expr: string): string {
    // 1. Braces, before any step that introduces braces of its own (\frac{}{},
    //    subscripts), so only the author's braces are converted.
    let latex = expr.replace(/\{/g, '\\left\\{').replace(/\}/g, '\\right\\}');

    // 2. Division, before the parentheses it reads as grouping become \left(.
    latex = convertDivisionToFrac(latex);

    // 3. Operators and delimiters.
    latex = latex.replace(/\*/g, '\\cdot ');
    latex = latex.replace(/<=/g, '\\le');
    latex = latex.replace(/>=/g, '\\ge');
    latex = latex.replace(/\(/g, '\\left(');
    latex = latex.replace(/\)/g, '\\right)');
    latex = sizeBars(latex);

    // 4. The functions with a shape of their own rather than a command.
    latex = convertShapedCalls(latex);

    // 5. Multi-letter names become subscripted: Desmos reads `abc` as a·b·c, so
    //    a variable of that name has to be written `a_{bc}`. Runs before step 6
    //    so that the backslashes it adds are not treated as name characters.
    latex = subscriptNames(latex);

    // 6. Built-in functions become their LaTeX command.
    for (const { pattern, latex: command } of FUNCTION_PATTERNS) {
        latex = latex.replace(pattern, command);
    }

    // 7. Constants and bare operators standing on their own become their command.
    latex = substituteNames(latex, CONSTANT_PATTERNS);
    latex = substituteNames(latex, OPERATOR_PATTERNS);

    // 8. Remaining syntax.
    latex = latex.replace(/->/g, '\\to');
    latex = latex.replace(/([a-zA-Z]+)_([a-zA-Z0-9]+)/g, '$1_{$2}');

    return removeSpaces(latex);
}

/**
 * `|x|` → `\left|x\right|`, so the bars grow around a tall expression.
 *
 * A bar is the same character opening and closing, so they are paired off in
 * order: the first opens, the second closes, and so on. Nested bars - `||x|-1|`
 * - have no reading this or any other pairing recovers, and Desmos does not
 * accept them either; `abs` is the way to write that.
 */
function sizeBars(input: string): string {
    let open = true;

    return input.replace(/\|/g, () => {
        const delimiter = open ? '\\left|' : '\\right|';
        open = !open;
        return delimiter;
    });
}

/**
 * The functions Desmos writes as a shape rather than a command, each given the
 * arguments it takes and the LaTeX it becomes.
 */
const SHAPED_FUNCTIONS = new Map<string, { arity: number; format: (args: string[]) => string }>([
    ['sqrt', { arity: 1, format: ([radicand]) => `\\sqrt{${radicand}}` }],
    ['nthroot', { arity: 2, format: ([radicand, index]) => `\\sqrt[${index}]{${radicand}}` }],
]);

/** The names above, longest first, so `nthroot` is never read as a shorter name. */
const SHAPED_NAMES = [...SHAPED_FUNCTIONS.keys()].sort((a, b) => b.length - a.length);

/**
 * `sqrt(x)` → `\sqrt{x}` and `nthroot(x, 3)` → `\sqrt[3]{x}`.
 *
 * Runs after step 3, so every group is delimited by `\left…` and `\right…` and
 * the call's extent can be found by matching those rather than guessed at with a
 * pattern: `sqrt(sin(x))` closes on the outer parenthesis, not the inner one.
 * Arguments are rewritten in turn, so nesting works to any depth.
 *
 * Anything that does not parse - an unbalanced call, or the wrong number of
 * arguments - is left exactly as written, for Desmos to report.
 */
function convertShapedCalls(input: string): string {
    let output = '';
    let index = 0;

    while (index < input.length) {
        const name = shapedNameAt(input, index);
        const shaped = name === undefined ? undefined : findCall(input, index + name.length);

        if (name === undefined || shaped === undefined) {
            output += input[index];
            index++;
            continue;
        }

        const { arity, format } = SHAPED_FUNCTIONS.get(name)!;
        const args = splitArguments(shaped.body);

        if (args.length !== arity) {
            output += input[index];
            index++;
            continue;
        }

        output += format(args.map(convertShapedCalls));
        index = shaped.end;
    }

    return output;
}

/** The shaped function whose call opens at `index`, if one does. */
function shapedNameAt(input: string, index: number): string | undefined {
    // A name carried by a longer one - `y_{abs}`, `arcsqrt` - is not a call.
    // A digit before it is not: `2sqrt(4)` is two times a square root, the same
    // reading {@link NOT_AFTER_NAME} gives every other name.
    if (/[a-zA-Z\\]/.test(input[index - 1] ?? '')) {
        return undefined;
    }

    return SHAPED_NAMES.find(
        name => input.startsWith(name, index) && input.startsWith('\\left(', index + name.length),
    );
}

/**
 * The body and extent of the `\left( … \right)` group starting at `index`.
 *
 * Depth counts every `\left` and `\right`, whatever they delimit, so a
 * piecewise `\left\{ … \right\}` inside the call is stepped over whole.
 */
function findCall(input: string, index: number): { body: string; end: number } | undefined {
    const start = index + '\\left('.length;
    let depth = 1;
    let cursor = start;

    while (cursor < input.length) {
        if (input.startsWith('\\left', cursor)) {
            depth++;
            cursor += '\\left'.length;
        } else if (input.startsWith('\\right', cursor)) {
            depth--;
            if (depth === 0) {
                return input[cursor + '\\right'.length] === ')'
                    ? { body: input.slice(start, cursor), end: cursor + '\\right)'.length }
                    : undefined;
            }
            cursor += '\\right'.length;
        } else {
            cursor++;
        }
    }

    return undefined;
}

/** Split a call body on the commas that separate its arguments, ignoring nested ones. */
function splitArguments(body: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let start = 0;

    for (let i = 0; i < body.length; i++) {
        if (body.startsWith('\\left', i)) {
            depth++;
        } else if (body.startsWith('\\right', i)) {
            depth--;
        } else if (body[i] === ',' && depth === 0) {
            args.push(body.slice(start, i).trim());
            start = i + 1;
        }
    }

    args.push(body.slice(start).trim());
    return args;
}

/**
 * `abc` → `a_{bc}`, and `alpha2` → `\alpha_{2}`.
 *
 * Desmos treats every letter of a bare name as a separate factor, so anything
 * longer than one character is written with the tail in a subscript. Built-in
 * names are exempt: they are about to become commands of their own.
 */
function subscriptNames(input: string): string {
    let latex = input;

    // A name that opens with a constant keeps the constant as a command.
    for (const { pattern, latex: command } of CONSTANT_PREFIX_PATTERNS) {
        latex = latex.replace(pattern, (match, suffix: string, offset: number, text: string) => {
            // `eta` is a constant in its own right, not `e` carrying `ta`.
            if (BUILT_IN_NAMES.has(match) || text[offset - 1] === '\\') {
                return match;
            }
            return `${command}_{${suffix}}`;
        });
    }

    return latex.replace(
        /(?<![a-zA-Z_])([a-zA-Z])([a-zA-Z0-9]+)\b/g,
        (match, first: string, rest: string, offset: number, text: string) => {
            if (BUILT_IN_NAMES.has(match)) {
                return match;
            }
            // Part of a command this pipeline already wrote (\left, \frac, …).
            if (text[offset - 1] === '\\') {
                return match;
            }
            // Already inside a subscript written by the loop above.
            if (text.slice(Math.max(0, offset - 5), offset).includes('_')) {
                return match;
            }
            return `${first}_{${rest}}`;
        },
    );
}

/** Replace each name with its command, except where it names a subscript. */
function substituteNames(
    input: string,
    patterns: readonly { pattern: RegExp; latex: string }[],
): string {
    let latex = input;

    for (const { pattern, latex: command } of patterns) {
        latex = latex.replace(pattern, (match, offset: number, text: string) => {
            if (text[offset - 1] === '\\') {
                return match;
            }
            return isInsideSubscript(text, offset) ? match : command;
        });
    }

    return latex;
}

/**
 * Whether `offset` sits inside a `_{ … }` subscript.
 *
 * Walks back for an opening brace with no closer between it and here. A
 * piecewise `\left\{` is a group we simply step out of and keep looking; only a
 * brace introduced by `_` means the name is a subscript rather than a constant.
 */
function isInsideSubscript(text: string, offset: number): boolean {
    let depth = 0;

    for (let i = offset - 1; i >= 0; i--) {
        if (text[i] === '}') {
            depth++;
        } else if (text[i] === '{') {
            if (depth > 0) {
                depth--;
            } else if (text[i - 1] === '_') {
                return true;
            }
        }
    }

    return false;
}

/**
 * Strip the whitespace Desmos does not want, keeping the single space a LaTeX
 * command needs to separate it from a letter that follows: `\cdot t` stays, but
 * `\cdot 5` closes up, since a digit already ends the command.
 */
function removeSpaces(latex: string): string {
    return latex.replace(/\s+/g, (match, offset: number, text: string) => {
        const before = text.slice(0, offset);
        const after = text.slice(offset + match.length);
        return /\\[a-zA-Z]+$/.test(before) && /^[a-zA-Z]/.test(after) ? ' ' : '';
    });
}

/**
 * `a/b` → `\frac{a}{b}`.
 *
 * The operands are read rather than matched: the numerator is the term ending
 * where the `/` is and the denominator the term starting after it, a term being
 * a name, a number, a bracketed group, or a call - a name and the group it
 * takes. That last one is why this is a scan and not a pattern. A pattern
 * reaching one bracket sees `f(x)/2` as `(x)` over 2 and writes
 * `f\frac{x}{2}`, which is a different expression, and one Desmos reports as
 * "'f' is a function. Try using parentheses."
 *
 * A term that cannot be read - one closing on a brace or a square bracket, or a
 * `^` between the operand and the slash - leaves the `/` where it is, which
 * Desmos still reads as division.
 */
function convertDivisionToFrac(expr: string): string {
    let output = '';
    let index = 0;

    while (index < expr.length) {
        if (expr[index] !== '/') {
            output += expr[index];
            index += 1;
            continue;
        }

        // The numerator is taken from what has been written rather than from
        // the input, so a fraction already made of the term in front of this
        // one is what gets divided.
        const numerator = termBefore(output);
        const denominator = termAfter(expr, index + 1);

        if (!numerator || !denominator) {
            output += '/';
            index += 1;
            continue;
        }

        output = `${output.slice(0, numerator.start)}\\frac{${numerator.text}}{${denominator.text}}`;
        index = denominator.end;
    }

    return output;
}

/** The characters a name or a number is made of. */
const TERM_CHARACTER = /[a-zA-Z0-9.]/;

/** The term `text` ends with, and where it starts. */
function termBefore(text: string): { start: number; text: string } | undefined {
    let end = text.length;
    while (end > 0 && /\s/.test(text[end - 1])) {
        end -= 1;
    }

    if (end === 0) {
        return undefined;
    }

    if (text[end - 1] === ')') {
        const open = groupStart(text, end - 1);
        if (open === -1) {
            return undefined;
        }

        const start = nameStart(text, open);
        return {
            start,
            // A group standing on its own is a bracket around the numerator,
            // and the `\frac` about to be written does that job itself.
            text: start === open ? text.slice(open + 1, end - 1) : text.slice(start, end),
        };
    }

    const start = runStart(text, end);
    return start === end ? undefined : { start, text: text.slice(start, end) };
}

/** The term starting at or after `from`, and where it ends. */
function termAfter(expr: string, from: number): { text: string; end: number } | undefined {
    let start = from;
    while (start < expr.length && /\s/.test(expr[start])) {
        start += 1;
    }

    if (expr[start] === '(') {
        const close = groupEnd(expr, start);
        return close === -1 ? undefined : { text: expr.slice(start + 1, close), end: close + 1 };
    }

    const end = runEnd(expr, start);
    if (end === start) {
        return undefined;
    }

    // A name takes the group after it: `2/f(x)` is 2 over f(x), not over f.
    if (expr[end] === '(' && /[a-zA-Z]/.test(expr.slice(start, end))) {
        const close = groupEnd(expr, end);
        if (close !== -1) {
            return { text: expr.slice(start, close + 1), end: close + 1 };
        }
    }

    return { text: expr.slice(start, end), end };
}

/**
 * Where the name calling the group at `open` starts, or `open` when the group
 * is not a call.
 *
 * A coefficient is not a name: `2f(x)` is twice `f(x)`, so the numerator of
 * `2f(x)/3` is the call and the 2 stays outside the fraction, where it means
 * the same thing.
 */
function nameStart(text: string, open: number): number {
    let start = open;
    while (start > 0 && /[a-zA-Z0-9]/.test(text[start - 1])) {
        start -= 1;
    }
    while (start < open && !/[a-zA-Z]/.test(text[start])) {
        start += 1;
    }

    return start;
}

/** Where the name or number ending at `end` starts, command backslash included. */
function runStart(text: string, end: number): number {
    let start = end;
    while (start > 0 && TERM_CHARACTER.test(text[start - 1])) {
        start -= 1;
    }

    return start > 0 && text[start - 1] === '\\' ? start - 1 : start;
}

/** Where the name or number starting at `start` ends. */
function runEnd(expr: string, start: number): number {
    let end = expr[start] === '\\' ? start + 1 : start;
    while (end < expr.length && TERM_CHARACTER.test(expr[end])) {
        end += 1;
    }

    return end === start + 1 && expr[start] === '\\' ? start : end;
}

/** The index of the `(` opening the group closed at `close`, or -1. */
function groupStart(text: string, close: number): number {
    let depth = 0;

    for (let index = close; index >= 0; index -= 1) {
        if (text[index] === ')') {
            depth += 1;
        } else if (text[index] === '(') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

/** The index of the `)` closing the group opened at `open`, or -1. */
function groupEnd(expr: string, open: number): number {
    let depth = 0;

    for (let index = open; index < expr.length; index += 1) {
        if (expr[index] === '(') {
            depth += 1;
        } else if (expr[index] === ')') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}
