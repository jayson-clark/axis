// ═════════════════════════════════════════════════════════════════════════════
// Desmos LaTeX back to Axis expressions
// ═════════════════════════════════════════════════════════════════════════════
//
// The inverse of `convertToLatex`, and the reason it is a scanner rather than a
// pipeline of replacements: LaTeX carries its structure in commands and groups
// (`\frac{a}{b}`, `\sqrt[3]{x}`), so reading it back means walking it once and
// recurring into each group, not rewriting the string in passes.
//
// Two things are not simply the mirror image of compiling:
//
//   - **A name is checked, not assumed.** `s_{tep}` reads back as `step`, but
//     `p_{i2}` cannot read back as `pi2`, which compiles to `\pi_{2}`. Every
//     candidate is compiled again and kept only if it comes back byte for byte,
//     so a name that would change meaning falls back to a spelling that does
//     not.
//   - **Division has to be re-parenthesised.** The compiler reads `/` with a
//     pattern that reaches one bracketed group either side, so `\frac{a+b}{2}`
//     is written `(a+b)/2` rather than `a+b/2`, and a fraction that sits next
//     to a name takes brackets it would not otherwise need: `c\frac{a}{b}` is
//     `c(a)/b`, since `ca/b` would compile with the `c` inside the numerator.
//
// Anything Axis itself emitted comes back exactly. LaTeX that Axis has no way
// of spelling - an `\operatorname` it does not know, a command it has never
// heard of - is passed through as written, which keeps the rest of the
// expression readable and leaves one recognisable thing to fix by hand.

import {
    AXIS_CONSTANT_NAMES,
    AXIS_FUNCTION_NAMES,
    AXIS_LATEX_FOR_CONSTANT,
    AXIS_OPERATOR_NAMES,
    getFunctionLatex,
} from '@axis-dsl/language';
import { convertToLatex } from './latex';

/** Every name the language defines, so a decompiled one can be checked against them. */
const BUILT_IN_NAMES = new Set([
    ...AXIS_FUNCTION_NAMES,
    ...AXIS_CONSTANT_NAMES,
    ...AXIS_OPERATOR_NAMES,
]);

/**
 * `\sin` → `sin`, for the functions Desmos writes as a command of their own.
 *
 * Shortest name first, so a command claimed by two names is read back as the
 * shorter one - which is the one the compiler would emit.
 */
const FUNCTION_FOR_COMMAND = new Map(
    [...AXIS_FUNCTION_NAMES]
        .reverse()
        .map(name => [getFunctionLatex(name), name] as const)
        .filter(([latex]) => /^\\[a-zA-Z]+$/.test(latex)),
);

/** `\pi` → `pi`, and every other constant with a command of its own. */
const CONSTANT_FOR_COMMAND = new Map(
    [...AXIS_LATEX_FOR_CONSTANT].map(([name, latex]) => [latex, name] as const).reverse(),
);

/** The `\left…`/`\right…` delimiters, and the plain bracket each stands for. */
const DELIMITERS = new Map([
    ['(', '('],
    [')', ')'],
    ['[', '['],
    [']', ']'],
    ['\\{', '{'],
    ['\\}', '}'],
    ['|', '|'],
    ['.', ''],
]);

/**
 * Convert Desmos LaTeX into the Axis expression it was compiled from.
 *
 * `convertToLatex(convertFromLatex(latex))` is `latex` for anything the
 * compiler emitted; the reverse holds up to the spacing and bracketing the
 * compiler normalises away.
 */
export function convertFromLatex(latex: string): string {
    let output = '';
    let index = 0;

    /**
     * Write `text`, keeping it a token of its own.
     *
     * Two names Desmos wrote back to back - `\sin\pi`, `a_{bc}x_{1}` - close up
     * into one when the commands and subscripts holding them apart are taken
     * away, so a space goes in where the letters would otherwise meet.
     */
    const emit = (text: string) => {
        output += /[a-zA-Z]$/.test(output) && /^[a-zA-Z]/.test(text) ? ` ${text}` : text;
    };

    /** What has been written so far, for the rules that need what precedes them. */
    const endsWithName = () => /[a-zA-Z0-9_)\]}]$/.test(output);

    while (index < latex.length) {
        const rest = latex.slice(index);

        // `\left(` and its family, back to the bare bracket they size.
        const delimiter = /^\\(?:left|right)(\\[{}]|[([|)\].])/.exec(rest);
        if (delimiter) {
            output += DELIMITERS.get(delimiter[1]) ?? '';
            index += delimiter[0].length;
            continue;
        }

        if (rest.startsWith('\\frac')) {
            const fraction = readFraction(latex, index + '\\frac'.length);
            if (fraction) {
                emit(
                    formatFraction(
                        convertFromLatex(fraction.numerator),
                        convertFromLatex(fraction.denominator),
                        endsWithName(),
                        latex.slice(fraction.end),
                    ),
                );
                index = fraction.end;
                continue;
            }
        }

        if (rest.startsWith('\\sqrt')) {
            const root = readRoot(latex, index + '\\sqrt'.length);
            if (root) {
                const radicand = convertFromLatex(root.radicand);
                emit(
                    root.index === undefined
                        ? `sqrt(${radicand})`
                        : `nthroot(${radicand}, ${convertFromLatex(root.index)})`,
                );
                index = root.end;
                continue;
            }
        }

        // `\operatorname{mean}` is how Desmos writes every multi-letter
        // function, whether or not Axis knows the name inside it.
        const operatorName = /^\\operatorname\{([a-zA-Z]+)\}/.exec(rest);
        if (operatorName) {
            emit(operatorName[1]);
            index += operatorName[0].length;
            if (/^[a-zA-Z0-9]/.test(latex.slice(index))) {
                // `\operatorname{for}i` is the operator and then a name of its
                // own. Written closed up they would be one word, so the space
                // the compiler dropped goes back.
                output += ' ';
            }
            continue;
        }

        // An exponent Desmos grouped - `x^{10}` - takes brackets instead, since
        // braces are a piecewise in Axis.
        if (rest.startsWith('^{')) {
            const group = readGroup(latex, index + 1);
            if (group) {
                output += `^(${convertFromLatex(group.body)})`;
                index = group.end;
                continue;
            }
        }

        const command = /^\\[a-zA-Z]+/.exec(rest);
        if (command) {
            const written = readCommand(latex, index, command[0]);
            emit(written.text);
            index = written.end;
            continue;
        }

        // `s_{tep}` is the variable `step`, written the only way Desmos reads a
        // name longer than one letter.
        const subscripted = /^([a-zA-Z])_\{([a-zA-Z0-9]+)\}/.exec(rest);
        if (subscripted) {
            emit(name(subscripted[1], subscripted[2], subscripted[0]));
            index += subscripted[0].length;
            if (/^[a-zA-Z0-9]/.test(latex.slice(index))) {
                // `a_{bc}x` is two names side by side. Written closed up they
                // would be one, so the space the compiler dropped goes back.
                output += ' ';
            }
            continue;
        }

        output += latex[index];
        index += 1;
    }

    return output;
}

/**
 * One command, and whatever it carries: a constant, a function, or something
 * this language has no name for and passes through.
 */
function readCommand(latex: string, index: number, command: string): { text: string; end: number } {
    const end = index + command.length;

    const constant = CONSTANT_FOR_COMMAND.get(command);
    if (constant) {
        // `\alpha_{2}` is the single name `alpha2`: the compiler keeps a
        // constant that opens a name as a command and subscripts the rest.
        const suffix = /^_\{([a-zA-Z0-9]+)\}/.exec(latex.slice(end));
        if (suffix) {
            return {
                text: name(constant, suffix[1], command + suffix[0]),
                end: end + suffix[0].length,
            };
        }
        return { text: constant, end };
    }

    const fn = FUNCTION_FOR_COMMAND.get(command);
    if (fn) {
        return { text: fn, end };
    }

    switch (command) {
        case '\\cdot':
            return { text: '*', end: skipSpace(latex, end) };
        // The inequalities keep their spaces for the same reason as the arrow:
        // `x<=pi` compiles to `\lepi`, with the constant swallowed by the
        // command in front of it.
        case '\\le':
            return { text: ' <= ', end: skipSpace(latex, end) };
        case '\\ge':
            return { text: ' >= ', end: skipSpace(latex, end) };
        // The arrow keeps its spaces: `a->a+1` compiles to `\toa+1`, since the
        // command runs straight into the letter after it.
        case '\\to':
            return { text: ' -> ', end: skipSpace(latex, end) };
        default:
            return { text: command, end };
    }
}

/**
 * A name split across a subscript, closed back up - but only if it compiles
 * back to what it was read from.
 *
 * `s_{tep}` is `step`, yet `m_{ean}` is not `mean`, which is a built-in that
 * compiles to `\operatorname{mean}`, and `p_{i2}` is not `pi2`, which compiles
 * to `\pi_{2}`. Where the closed-up name would change, the underscore stays:
 * `m_ean` compiles back to exactly the subscript it came from.
 */
function name(head: string, tail: string, latex: string): string {
    const joined = `${head}${tail}`;
    if (!BUILT_IN_NAMES.has(joined) && convertToLatex(joined) === latex) {
        return joined;
    }

    const underscored = `${head}_${tail}`;
    return convertToLatex(underscored) === latex ? underscored : latex;
}

/**
 * `\frac{a}{b}` back to a division, bracketed however the compiler's reading of
 * `/` demands.
 *
 * That reading takes one bracketed group either side, so a side is left bare
 * only when it is a single run of letters and digits - and not even then if the
 * text beside it would be swept into the fraction: `ca/b` compiles with the `c`
 * in the numerator, so a fraction that follows a name gets brackets.
 */
function formatFraction(
    numerator: string,
    denominator: string,
    afterName: boolean,
    rest: string,
): string {
    const bare = (part: string) => /^[a-zA-Z0-9]+$/.test(part);

    const top = bare(numerator) && !afterName ? numerator : `(${numerator})`;
    const bottom =
        bare(denominator) && !/^[a-zA-Z0-9]/.test(rest) ? denominator : `(${denominator})`;

    return `${top}/${bottom}`;
}

/** The two groups of a `\frac`, if both are there. */
function readFraction(
    latex: string,
    index: number,
): { numerator: string; denominator: string; end: number } | undefined {
    const numerator = readGroup(latex, index);
    const denominator = numerator && readGroup(latex, numerator.end);

    return numerator && denominator
        ? { numerator: numerator.body, denominator: denominator.body, end: denominator.end }
        : undefined;
}

/** The radicand of a `\sqrt`, and its index when it is an `\sqrt[n]{…}`. */
function readRoot(
    latex: string,
    index: number,
): { radicand: string; index?: string; end: number } | undefined {
    const degree = latex[index] === '[' ? readGroup(latex, index, '[', ']') : undefined;
    if (latex[index] === '[' && !degree) {
        return undefined;
    }

    const radicand = readGroup(latex, degree ? degree.end : index);
    return radicand
        ? { radicand: radicand.body, index: degree?.body, end: radicand.end }
        : undefined;
}

/**
 * The body and extent of the group opening at `index`.
 *
 * Only unescaped braces nest: `\left\{` and `\right\}` are a piecewise the
 * group holds, not the group closing early.
 */
function readGroup(
    latex: string,
    index: number,
    open = '{',
    close = '}',
): { body: string; end: number } | undefined {
    if (latex[index] !== open) {
        return undefined;
    }

    let depth = 0;

    for (let cursor = index; cursor < latex.length; cursor += 1) {
        if (latex[cursor] === '\\') {
            cursor += 1;
            continue;
        }
        if (latex[cursor] === open) {
            depth += 1;
        } else if (latex[cursor] === close) {
            depth -= 1;
            if (depth === 0) {
                return { body: latex.slice(index + 1, cursor), end: cursor + 1 };
            }
        }
    }

    return undefined;
}

/** Past the single space a command keeps to hold itself apart from a letter. */
function skipSpace(latex: string, index: number): number {
    return latex[index] === ' ' ? index + 1 : index;
}
