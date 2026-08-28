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
    getFunctionLatex,
} from '@axis-dsl/language';

/** Every name the language defines, so the subscript rule leaves them alone. */
const BUILT_IN_NAMES = new Set([...AXIS_FUNCTION_NAMES, ...AXIS_CONSTANT_NAMES]);

/**
 * `alpha2` → `\alpha_{2}`: a constant with a LaTeX form, carrying a suffix.
 *
 * Only constants that survive to become commands are listed - matching `e`
 * against `epsilon` would otherwise split a constant into `\e_{psilon}`.
 * Longest first for the same reason, and the whole word is checked against the
 * constant list so `eta` is not read as `e` + `ta`.
 */
const CONSTANT_PREFIX_PATTERNS = [...AXIS_LATEX_FOR_CONSTANT].map(([name, latex]) => ({
    pattern: new RegExp(`\\b${name}([a-zA-Z0-9]+)\\b`, 'g'),
    latex,
}));

/** `sin` → `\sin`, longest first so `arcsin` is not clipped to `arc` + `sin`. */
const FUNCTION_PATTERNS = AXIS_FUNCTION_NAMES.map(name => ({
    pattern: new RegExp(`\\b${name}(?=\\s*\\\\left\\(|\\s|$)`, 'g'),
    latex: getFunctionLatex(name),
}));

/** `pi` → `\pi`, for a constant standing on its own. */
const CONSTANT_PATTERNS = [...AXIS_LATEX_FOR_CONSTANT].map(([name, latex]) => ({
    pattern: new RegExp(`\\b${name}\\b`, 'g'),
    latex,
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

    // 7. Constants standing on their own become their command.
    latex = substituteConstants(latex);

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
    if (/[a-zA-Z0-9\\]/.test(input[index - 1] ?? '')) {
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
        /\b([a-zA-Z])([a-zA-Z0-9]+)\b/g,
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

/** Replace each constant with its command, except where it names a subscript. */
function substituteConstants(input: string): string {
    let latex = input;

    for (const { pattern, latex: command } of CONSTANT_PATTERNS) {
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
 * Pattern-based rather than parsed, so it reaches one level of parenthesised
 * group on either side; a deeper expression keeps its `/`, which Desmos still
 * reads as division.
 */
function convertDivisionToFrac(expr: string): string {
    return expr
        .replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, '\\frac{$1}{$2}')
        .replace(/\(([^()]+)\)\s*\/\s*([a-zA-Z0-9\\]+)/g, '\\frac{$1}{$2}')
        .replace(/([a-zA-Z0-9\\]+)\s*\/\s*\(([^()]+)\)/g, '\\frac{$1}{$2}')
        .replace(/([a-zA-Z0-9]+|\\[a-zA-Z]+)\s*\/\s*([a-zA-Z0-9]+|\\[a-zA-Z]+)/g, '\\frac{$1}{$2}');
}
