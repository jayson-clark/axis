// ═════════════════════════════════════════════════════════════════════════════
// Desmos latex to expression trees
// ═════════════════════════════════════════════════════════════════════════════
//
// The emitter's inverse, and the decompiler's way in: what a graph holds is
// latex, and everything downstream wants the tree. A recursive-descent parser
// over latex tokens, with the precedence table of spec §5.1 - the same one the
// Axis parser uses, so a tree read from latex is the tree the same expression
// would have been read as from source.
//
// It reads two dialects. One is the emitter's, which is regular: every
// exponent braced, every bracket sized, a `\cdot` wherever juxtaposition would
// have been misread. The other is whatever Desmos writes itself, which a graph
// made at desmos.com is full of - `x^2` with its script unbraced, `\frac12`,
// bare brackets, `\sin x` with no brackets at all, `\le`, `\left[1,...,10\right]`
// from v1. Where the two meet, Desmos' reading is the one followed, since that
// is what the latex means on the graph it came from.
//
// Spans are offsets into the latex, not into any source: a tree read from a
// graph has no source yet. Anything this cannot read - a `\sum`, which the
// tree has no node for, or latex that is not well-formed - throws a
// `LatexParseError` carrying the offset.

import type {
    Binding,
    ComparisonOperator,
    Expression,
    Identifier,
    NumberLiteral,
    PiecewiseBranch,
    Span,
} from '@axis-dsl/syntax';
import { CONSTANT_FOR_COMMAND, FUNCTION_FOR_COMMAND, FUNCTION_NAMES, nameFromLatex } from './names';

/** Latex this parser has no reading for, and where in it the trouble is. */
export class LatexParseError extends Error {
    constructor(
        message: string,
        readonly offset: number,
    ) {
        super(message);
        this.name = 'LatexParseError';
    }
}

/**
 * Read Desmos latex as an expression tree.
 *
 * Identifiers come back in Axis spelling (`a_{mp}` → `amp`, `\theta_{2}` →
 * `theta2`), `\cdot` as `*` and juxtaposition as `implicit`, `\frac` as `/`,
 * and bracket pairs - sized or not - as `Paren` nodes, the way the author of
 * the latex bracketed it. A name followed by a bracket is a `Call`, whatever
 * the name, exactly as the Axis parser reads `a(b)`: whether it is really a
 * call is the checker's decision (spec §5.3).
 */
export function parseLatex(latex: string): Expression {
    return new Parser(latex, tokenize(latex)).parse();
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────────────

type Delimiter = '(' | '[' | '{' | '|';

type Token = { start: number; end: number } & (
    | { type: 'number'; text: string }
    | { type: 'letter'; text: string }
    /** `\sin`, `\pi`, `\cdot`: any control word, backslash dropped. */
    | { type: 'command'; name: string }
    /** `\operatorname{mean}` - the name inside. */
    | { type: 'operatorname'; name: string }
    /** `(`, `\left(`, `\{`, `\left|`: an opening bracket, sized or not. */
    | { type: 'open'; delimiter: Delimiter; sized: boolean }
    | { type: 'close'; delimiter: Delimiter; sized: boolean }
    /** A bare `|`, which could be either end of a pair. */
    | { type: 'bar' }
    /** A TeX group's braces - grouping, not a piecewise. */
    | { type: 'group-open' }
    | { type: 'group-close' }
    | { type: 'symbol'; text: string }
    | { type: 'end' }
);

/**
 * The spacing commands. Desmos writes `\ ` and `\space` between things it
 * wants apart on the page, and they mean nothing to the maths.
 */
const SPACING = new Set([' ', ',', ':', ';', '!', 'space', 'quad', 'qquad']);

const DELIMITERS: Record<string, { delimiter: Delimiter; open: boolean }> = {
    '(': { delimiter: '(', open: true },
    ')': { delimiter: '(', open: false },
    '[': { delimiter: '[', open: true },
    ']': { delimiter: '[', open: false },
    '\\{': { delimiter: '{', open: true },
    '\\}': { delimiter: '{', open: false },
};

function tokenize(latex: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;

    const push = (token: Token) => {
        tokens.push(token);
        index = token.end;
    };

    while (index < latex.length) {
        const start = index;
        const rest = latex.slice(index);
        const char = latex[index];

        if (/\s/.test(char)) {
            index++;
            continue;
        }

        const number = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(rest);
        if (number && !rest.startsWith('...')) {
            push({ type: 'number', text: number[0], start, end: start + number[0].length });
            continue;
        }

        if (/[a-zA-Z]/.test(char)) {
            push({ type: 'letter', text: char, start, end: start + 1 });
            continue;
        }

        if (char === '\\') {
            const word = /^\\([a-zA-Z]+)/.exec(rest);
            const symbol = word ? undefined : rest.slice(1, 2);

            if (symbol !== undefined) {
                if (SPACING.has(symbol)) {
                    index += 2;
                    continue;
                }
                const bracket = DELIMITERS[`\\${symbol}`];
                if (bracket) {
                    push({
                        type: bracket.open ? 'open' : 'close',
                        delimiter: bracket.delimiter,
                        sized: false,
                        start,
                        end: start + 2,
                    });
                    continue;
                }
                throw new LatexParseError(`Unexpected '\\${symbol}'`, start);
            }

            const name = word![1];
            let end = start + word![0].length;

            if (SPACING.has(name)) {
                index = end;
                continue;
            }

            if (name === 'left' || name === 'right') {
                while (latex[end] === ' ') end++;
                const delimiter = /^(?:\\[{}]|[()[\]|])/.exec(latex.slice(end));
                if (!delimiter) {
                    throw new LatexParseError(`'\\${name}' with no bracket after it`, start);
                }
                end += delimiter[0].length;
                const bracket =
                    delimiter[0] === '|'
                        ? { delimiter: '|' as const, open: name === 'left' }
                        : DELIMITERS[delimiter[0]];
                push({
                    type: name === 'left' ? 'open' : 'close',
                    delimiter: bracket.delimiter,
                    sized: true,
                    start,
                    end,
                });
                continue;
            }

            if (name === 'operatorname') {
                const argument = /^\s*\{([a-zA-Z]+)\}/.exec(latex.slice(end));
                if (!argument) {
                    throw new LatexParseError("'\\operatorname' with no name after it", start);
                }
                push({
                    type: 'operatorname',
                    name: argument[1],
                    start,
                    end: end + argument[0].length,
                });
                continue;
            }

            push({ type: 'command', name, start, end });
            continue;
        }

        const bracket = DELIMITERS[char];
        if (bracket) {
            push({
                type: bracket.open ? 'open' : 'close',
                delimiter: bracket.delimiter,
                sized: false,
                start,
                end: start + 1,
            });
            continue;
        }

        if (char === '{') {
            push({ type: 'group-open', start, end: start + 1 });
            continue;
        }
        if (char === '}') {
            push({ type: 'group-close', start, end: start + 1 });
            continue;
        }
        if (char === '|') {
            push({ type: 'bar', start, end: start + 1 });
            continue;
        }

        const symbol = /^(?:\.\.\.|<=|>=|[-+*/=<>,:!.^_])/.exec(rest);
        if (symbol) {
            push({ type: 'symbol', text: symbol[0], start, end: start + symbol[0].length });
            continue;
        }

        throw new LatexParseError(`Unexpected '${char}'`, start);
    }

    tokens.push({ type: 'end', start: latex.length, end: latex.length });
    return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// The parser
// ─────────────────────────────────────────────────────────────────────────────

const COMPARISONS: Record<string, ComparisonOperator> = {
    '=': '=',
    '<': '<',
    '>': '>',
    '<=': '<=',
    '>=': '>=',
    '\\lt': '<',
    '\\gt': '>',
    '\\le': '<=',
    '\\leq': '<=',
    '\\ge': '>=',
    '\\geq': '>=',
};

/** `\sin^{-1}` is how Desmos writes arcsin. */
const INVERSES: Record<string, string> = {
    sin: 'arcsin',
    cos: 'arccos',
    tan: 'arctan',
    csc: 'arccsc',
    sec: 'arcsec',
    cot: 'arccot',
};

/**
 * `R=a\to1,b\to2` as the definition it is: `R` equal to the run.
 *
 * By precedence alone the `=` binds tightest and the run swallows it - an
 * action whose target is `R=a`, then another - which is nothing anybody means.
 * Spec §5.6 names a run by defining it, so where the first thing in a run (or
 * a lone action) is an `=`, the `=` is taken to hold everything after it. `R=A,B`
 * is the same, with names for the actions.
 */
function definition(expression: Expression): Expression {
    const elements = expression.kind === 'Sequence' ? expression.elements : [expression];
    const [first, ...rest] = elements;

    const equation = first.kind === 'Action' ? first.target : first;
    if (
        equation.kind !== 'Comparison' ||
        equation.operators.length !== 1 ||
        equation.operators[0] !== '=' ||
        (first.kind !== 'Action' && rest.length === 0)
    ) {
        return expression;
    }

    const [name, value] = equation.operands;
    const head: Expression =
        first.kind === 'Action'
            ? { ...first, target: value, span: { start: value.span.start, end: first.span.end } }
            : value;
    const run: Expression =
        rest.length === 0
            ? head
            : {
                  kind: 'Sequence',
                  elements: [head, ...rest],
                  span: { start: head.span.start, end: expression.span.end },
              };

    return {
        kind: 'Comparison',
        operands: [name, run],
        operators: ['='],
        span: expression.span,
    };
}

class Parser {
    private position = 0;
    /** Bare bars open around the point being read, which a bare bar then closes. */
    private bars = 0;

    constructor(
        private readonly latex: string,
        private readonly tokens: Token[],
    ) {}

    parse(): Expression {
        const expression = this.bindingLevel(true);
        this.expectEnd();
        return expression;
    }

    // ── Levels, loosest first ───────────────────────────────────────────────

    /**
     * `body \operatorname{with} a=1, b=2`, and `for` alike. A run of actions is
     * only allowed at the very top, where a bracket is not holding the commas.
     */
    private bindingLevel(allowSequence: boolean): Expression {
        const start = this.peek().start;
        let body = allowSequence ? definition(this.sequence()) : this.action();

        for (;;) {
            const token = this.peek();
            if (token.type !== 'operatorname' || (token.name !== 'with' && token.name !== 'for')) {
                return body;
            }
            this.advance();
            const bindings = this.bindings();
            body = {
                kind: token.name === 'with' ? 'With' : 'For',
                body,
                bindings,
                span: this.span(start),
            };
        }
    }

    private sequence(): Expression {
        const start = this.peek().start;
        const first = this.action();
        if (!this.isSymbol(',')) {
            return first;
        }

        const elements = [first];
        while (this.eatSymbol(',')) {
            elements.push(this.action());
        }
        return { kind: 'Sequence', elements, span: this.span(start) };
    }

    private action(): Expression {
        const start = this.peek().start;
        const target = this.comparison();
        const arrow = this.peek();
        if (arrow.type === 'command' && (arrow.name === 'to' || arrow.name === 'rightarrow')) {
            this.advance();
            const value = this.comparison();
            return { kind: 'Action', target, value, span: this.span(start) };
        }
        return target;
    }

    private comparison(): Expression {
        const start = this.peek().start;
        const operands = [this.additive()];
        const operators: ComparisonOperator[] = [];

        for (let operator = this.comparisonOperator(); operator;) {
            this.advance();
            operators.push(operator);
            operands.push(this.additive());
            operator = this.comparisonOperator();
        }

        return operators.length === 0
            ? operands[0]
            : { kind: 'Comparison', operands, operators, span: this.span(start) };
    }

    private comparisonOperator(): ComparisonOperator | undefined {
        const token = this.peek();
        if (token.type === 'symbol') {
            return COMPARISONS[token.text];
        }
        if (token.type === 'command') {
            return COMPARISONS[`\\${token.name}`];
        }
        return undefined;
    }

    private additive(): Expression {
        const start = this.peek().start;
        let left = this.product();

        for (;;) {
            const token = this.peek();
            if (token.type !== 'symbol' || (token.text !== '+' && token.text !== '-')) {
                return left;
            }
            this.advance();
            const right = this.product();
            left = { kind: 'Binary', operator: token.text, left, right, span: this.span(start) };
        }
    }

    /**
     * `a\cdot b`, `a/b`, and juxtaposition: anything that can open an operand,
     * straight after one, is a product.
     */
    private product(): Expression {
        const start = this.peek().start;
        let left = this.prefix();

        for (;;) {
            const token = this.peek();
            let operator: '*' | '/' | 'implicit';

            if (token.type === 'command' && (token.name === 'cdot' || token.name === 'times')) {
                operator = '*';
            } else if (token.type === 'command' && token.name === 'div') {
                operator = '/';
            } else if (token.type === 'symbol' && (token.text === '*' || token.text === '/')) {
                operator = token.text;
            } else if (this.opensOperand(token)) {
                operator = 'implicit';
            } else {
                return left;
            }

            if (operator !== 'implicit') {
                this.advance();
            }
            const right = this.prefix();
            left = { kind: 'Binary', operator, left, right, span: this.span(start) };
        }
    }

    private prefix(): Expression {
        const token = this.peek();
        if (token.type === 'symbol' && (token.text === '-' || token.text === '+')) {
            this.advance();
            const operand = this.prefix();
            return {
                kind: 'Unary',
                operator: token.text,
                operand,
                span: this.span(token.start),
            };
        }
        return this.power();
    }

    /**
     * `base^{exponent}`. The exponent is a script - braced, or a single
     * character - so it never runs on, and right-association comes from the
     * braces: `2^{3^{2}}`.
     */
    private power(): Expression {
        const start = this.peek().start;
        const base = this.postfix(this.primary(), start);
        if (!this.eatSymbol('^')) {
            return base;
        }

        const exponent = this.script();
        const power: Expression = {
            kind: 'Binary',
            operator: '^',
            left: base,
            right: exponent,
            span: this.span(start),
        };
        // `x^{2}!` - a postfix after a power is the power's.
        return this.postfix(power, start);
    }

    /** `!`, `.x`, `.\operatorname{count}` and `[i]`, as many as follow. */
    private postfix(target: Expression, start: number): Expression {
        for (;;) {
            const token = this.peek();

            if (token.type === 'symbol' && token.text === '!') {
                this.advance();
                target = { kind: 'Factorial', operand: target, span: this.span(start) };
            } else if (token.type === 'symbol' && token.text === '.') {
                this.advance();
                const name = this.memberName();
                target = { kind: 'Member', target, name, span: this.span(start) };
            } else if (token.type === 'open' && token.delimiter === '[') {
                // Brackets after anything index it; that is Desmos' reading,
                // and the emitter never writes a list beside a value.
                this.advance();
                const elements = this.elements('[', true);
                const index: Expression =
                    elements.length === 1
                        ? elements[0]
                        : { kind: 'List', elements, span: this.span(token.start) };
                target = { kind: 'Index', target, index, span: this.span(start) };
            } else {
                return target;
            }
        }
    }

    private memberName(): Identifier {
        const token = this.peek();
        if (token.type === 'letter') {
            return this.identifier();
        }
        if (token.type === 'operatorname') {
            this.advance();
            return { kind: 'Identifier', name: token.name, span: this.span(token.start) };
        }
        if (token.type === 'command' && FUNCTION_FOR_COMMAND.has(`\\${token.name}`)) {
            this.advance();
            return {
                kind: 'Identifier',
                name: FUNCTION_FOR_COMMAND.get(`\\${token.name}`)!,
                span: this.span(token.start),
            };
        }
        throw this.error("Expected a name after '.'");
    }

    // ── Primaries ───────────────────────────────────────────────────────────

    private primary(): Expression {
        const token = this.peek();

        switch (token.type) {
            case 'number':
                this.advance();
                return { kind: 'Number', value: token.text, span: this.span(token.start) };

            case 'letter':
                return this.maybeCall(this.identifier());

            case 'operatorname': {
                if (FUNCTION_NAMES.has(token.name)) {
                    this.advance();
                    return this.builtin(token.name, token.start);
                }
                if (token.name === 'with' || token.name === 'for') {
                    throw this.error(`'${token.name}' with nothing in front of it`);
                }
                // `\operatorname{dt}`, `\operatorname{width}`, or a name Axis
                // has never heard of, which is kept as the name it is.
                this.advance();
                return this.maybeCall({
                    kind: 'Identifier',
                    name: token.name,
                    span: this.span(token.start),
                });
            }

            case 'command':
                return this.command(token.name, token.start);

            case 'open':
                return this.bracketed(token.delimiter, token.start);

            case 'bar': {
                this.advance();
                this.bars++;
                const expression = this.bindingLevel(false);
                this.bars--;
                if (this.peek().type !== 'bar') {
                    throw this.error("Expected a closing '|'");
                }
                this.advance();
                return { kind: 'Abs', expression, span: this.span(token.start) };
            }

            case 'group-open': {
                // A TeX group is only grouping: `{a+b}` is `a+b`.
                this.advance();
                const expression = this.bindingLevel(true);
                this.expect('group-close', "Expected '}'");
                return expression;
            }
        }

        throw this.error('Expected an expression');
    }

    private command(name: string, start: number): Expression {
        const latex = `\\${name}`;

        if (name === 'frac') {
            this.advance();
            const left = this.script();
            const right = this.script();
            return { kind: 'Binary', operator: '/', left, right, span: this.span(start) };
        }

        if (name === 'sqrt') {
            this.advance();
            const degree = this.peek();
            if (degree.type === 'open' && degree.delimiter === '[' && !degree.sized) {
                this.advance();
                const index = this.bindingLevel(false);
                this.expectClose('[');
                const radicand = this.script();
                return this.call('nthroot', [radicand, index], start, start);
            }
            return this.call('sqrt', [this.script()], start, start);
        }

        const constant = CONSTANT_FOR_COMMAND.get(latex);
        if (constant) {
            this.advance();
            const subscript = this.subscript();
            const name =
                subscript === undefined
                    ? constant
                    : nameFromLatex(constant, subscript, `${latex}_{${subscript}}`);
            return this.maybeCall({ kind: 'Identifier', name, span: this.span(start) });
        }

        const fn = FUNCTION_FOR_COMMAND.get(latex);
        if (fn) {
            this.advance();
            return this.builtin(fn, start);
        }

        throw this.error(`Axis has no reading for '${latex}'`);
    }

    /**
     * A built-in function, however Desmos wrote its argument: bracketed, or
     * bare - `\sin x`, `\sin 2\pi t` - where the argument is the whole product
     * that follows, as Desmos reads it (`\sin a\cdot b` is sin(ab)). `\sin^{2}x`
     * is the square of the call, and `\sin^{-1}` is arcsin.
     */
    private builtin(name: string, start: number): Expression {
        const exponent = this.eatSymbol('^') ? this.script() : undefined;
        const inverse =
            exponent &&
            INVERSES[name] &&
            exponent.kind === 'Unary' &&
            exponent.operator === '-' &&
            exponent.operand.kind === 'Number' &&
            exponent.operand.value === '1';
        const callee = inverse ? INVERSES[name] : name;

        let result: Expression;
        const next = this.peek();
        if (next.type === 'open' && next.delimiter === '(') {
            this.advance();
            result = this.call(callee, this.elements('(', false), start, start);
        } else if (this.opensOperand(next)) {
            result = this.call(callee, [this.product()], start, start);
        } else {
            // A function's name on its own - `\max` with nothing after it.
            result = { kind: 'Identifier', name: callee, span: this.span(start) };
        }

        return exponent && !inverse
            ? {
                  kind: 'Binary',
                  operator: '^',
                  left: result,
                  right: exponent,
                  span: this.span(start),
              }
            : result;
    }

    private call(name: string, args: Expression[], start: number, calleeStart: number): Expression {
        return {
            kind: 'Call',
            callee: { kind: 'Identifier', name, span: { start: calleeStart, end: calleeStart } },
            arguments: args,
            span: this.span(start),
        };
    }

    /** A name with a bracket straight after it is called with what is inside. */
    private maybeCall(callee: Identifier): Expression {
        const next = this.peek();
        if (next.type !== 'open' || next.delimiter !== '(') {
            return callee;
        }
        this.advance();
        const args = this.elements('(', false);
        return { kind: 'Call', callee, arguments: args, span: this.span(callee.span.start) };
    }

    /** `x`, `x_{1}`, `a_{mp}`, `x_1` - a letter and any subscript it carries. */
    private identifier(): Identifier {
        const token = this.peek();
        if (token.type !== 'letter') {
            throw this.error('Expected a name');
        }
        this.advance();
        const subscript = this.subscript();
        const name =
            subscript === undefined
                ? token.text
                : nameFromLatex(token.text, subscript, `${token.text}_{${subscript}}`);
        return { kind: 'Identifier', name, span: this.span(token.start) };
    }

    /** The letters and digits of a `_{…}` or `_x`, if one follows. */
    private subscript(): string | undefined {
        if (!this.eatSymbol('_')) {
            return undefined;
        }

        const token = this.peek();
        if (token.type === 'group-open') {
            this.advance();
            let text = '';
            for (let part = this.peek(); part.type !== 'group-close'; part = this.peek()) {
                if (part.type !== 'letter' && part.type !== 'number') {
                    throw this.error('A subscript Axis can name has only letters and digits');
                }
                text += part.text;
                this.advance();
            }
            this.advance();
            if (!/^[a-zA-Z0-9]+$/.test(text)) {
                throw this.error('A subscript Axis can name has only letters and digits');
            }
            return text;
        }

        if (token.type === 'letter') {
            this.advance();
            return token.text;
        }
        if (token.type === 'number') {
            return this.firstDigit(token).value;
        }
        throw this.error("Expected a subscript after '_'");
    }

    /**
     * An argument to `^`, `\frac` or `\sqrt`: a braced group, or - as TeX has
     * it - the one character after it. `x^23` is x²·3, not x²³.
     */
    private script(): Expression {
        const token = this.peek();

        switch (token.type) {
            case 'group-open': {
                this.advance();
                const expression = this.bindingLevel(true);
                this.expect('group-close', "Expected '}'");
                return expression;
            }
            case 'number':
                return this.firstDigit(token);
            case 'letter':
                this.advance();
                return { kind: 'Identifier', name: token.text, span: this.span(token.start) };
            case 'command': {
                const constant = CONSTANT_FOR_COMMAND.get(`\\${token.name}`);
                if (constant) {
                    this.advance();
                    return { kind: 'Identifier', name: constant, span: this.span(token.start) };
                }
            }
        }
        throw this.error('Expected a braced group or a single character');
    }

    /**
     * The first character of a number token, leaving the rest to be read as
     * what follows it - the unbraced script `x^23`.
     */
    private firstDigit(token: Token & { type: 'number' }): NumberLiteral {
        const span = { start: token.start, end: token.start + 1 };
        if (token.text.length === 1) {
            this.advance();
        } else {
            this.tokens[this.position] = { ...token, text: token.text.slice(1), start: span.end };
        }
        return { kind: 'Number', value: token.text[0], span };
    }

    /**
     * `(…)`, `[…]`, `\{…\}` and `|…|` wherever they stand as a value: a paren
     * or a point, a list, a piecewise, an absolute value.
     */
    private bracketed(delimiter: Delimiter, start: number): Expression {
        this.advance();

        switch (delimiter) {
            case '(': {
                const elements = this.elements('(', false);
                if (elements.length === 0) {
                    throw new LatexParseError('Empty brackets', start);
                }
                return elements.length === 1
                    ? { kind: 'Paren', expression: elements[0], span: this.span(start) }
                    : { kind: 'Tuple', elements, span: this.span(start) };
            }
            case '[':
                return { kind: 'List', elements: this.elements('[', true), span: this.span(start) };
            case '{':
                return this.piecewise(start);
            case '|': {
                const expression = this.bindingLevel(false);
                this.expectClose('|');
                return { kind: 'Abs', expression, span: this.span(start) };
            }
        }
    }

    /**
     * The comma-separated elements up to the bracket that closes them, which
     * is consumed. In a list, `a...b` is a range - and so is `a,...,b`, which
     * is how v1 wrote one.
     */
    private elements(delimiter: Delimiter, ranges: boolean): Expression[] {
        const elements: Expression[] = [];
        if (this.peekClose(delimiter)) {
            this.advance();
            return elements;
        }

        for (;;) {
            if (ranges && this.isSymbol('...') && elements.length > 0) {
                this.advance();
                this.eatSymbol(',');
                const from = elements.pop()!;
                const to = this.bindingLevel(false);
                elements.push({ kind: 'ListRange', from, to, span: this.span(from.span.start) });
            } else {
                const start = this.peek().start;
                const element = this.bindingLevel(false);
                if (ranges && this.eatSymbol('...')) {
                    const to = this.bindingLevel(false);
                    elements.push({ kind: 'ListRange', from: element, to, span: this.span(start) });
                } else {
                    elements.push(element);
                }
            }

            if (!this.eatSymbol(',')) {
                break;
            }
        }

        this.expectClose(delimiter);
        return elements;
    }

    /**
     * `\left\{c:v, c:v, otherwise\right\}`, or a restriction `\left\{x>0\right\}`.
     *
     * An element with no `:` is the `otherwise` when it comes last after at
     * least one that had one, and a bare condition anywhere else: `{x<0: -x, x}`
     * has an otherwise, `{x>0, x<2}` is two restrictions.
     */
    private piecewise(start: number): Expression {
        const items: { condition: Expression; value: Expression | null; start: number }[] = [];

        if (!this.peekClose('{')) {
            do {
                const itemStart = this.peek().start;
                const condition = this.bindingLevel(false);
                const value = this.eatSymbol(':') ? this.bindingLevel(false) : null;
                items.push({ condition, value, start: itemStart });
            } while (this.eatSymbol(','));
        }
        this.expectClose('{');

        const last = items[items.length - 1];
        const otherwise =
            last && last.value === null && items.some(item => item.value !== null)
                ? items.pop()!.condition
                : null;

        const branches: PiecewiseBranch[] = items.map(({ condition, value, start: at }) => ({
            kind: 'PiecewiseBranch',
            condition,
            value,
            span: { start: at, end: (value ?? condition).span.end },
        }));

        return { kind: 'Piecewise', branches, otherwise, span: this.span(start) };
    }

    /** `a=1,b=2` after a `with` or a `for`: as many as there are. */
    private bindings(): Binding[] {
        const bindings: Binding[] = [];

        do {
            const start = this.peek().start;
            const name = this.bindingName();
            if (!this.eatSymbol('=')) {
                throw this.error("Expected '=' in a binding");
            }
            const value = this.additive();
            bindings.push({ kind: 'Binding', name, value, span: this.span(start) });
        } while (this.isSymbol(',') && this.bindingFollows() && this.advance());

        return bindings;
    }

    private bindingName(): Identifier {
        const token = this.peek();
        if (token.type === 'command' && CONSTANT_FOR_COMMAND.has(`\\${token.name}`)) {
            const name = this.command(token.name, token.start);
            if (name.kind === 'Identifier') {
                return name;
            }
        }
        return this.identifier();
    }

    /**
     * Whether the comma ahead starts another binding - `, b=2` - rather than
     * ending the run, which is where the bracket around it takes over.
     */
    private bindingFollows(): boolean {
        const saved = this.position;
        try {
            this.advance();
            this.bindingName();
            return this.isSymbol('=');
        } catch {
            return false;
        } finally {
            this.position = saved;
        }
    }

    // ── Tokens ──────────────────────────────────────────────────────────────

    /** Whether `token` can begin an operand, which is what makes a juxtaposition. */
    private opensOperand(token: Token): boolean {
        switch (token.type) {
            case 'number':
            case 'letter':
            case 'open':
            case 'group-open':
                return true;
            case 'operatorname':
                return token.name !== 'with' && token.name !== 'for';
            case 'command': {
                const latex = `\\${token.name}`;
                return (
                    token.name === 'frac' ||
                    token.name === 'sqrt' ||
                    CONSTANT_FOR_COMMAND.has(latex) ||
                    FUNCTION_FOR_COMMAND.has(latex)
                );
            }
            case 'bar':
                // Inside a pair of bare bars, the next bar is the closing one.
                return this.bars === 0;
        }
        return false;
    }

    private peek(): Token {
        return this.tokens[this.position];
    }

    private advance(): true {
        if (this.peek().type !== 'end') {
            this.position++;
        }
        return true;
    }

    private isSymbol(text: string): boolean {
        const token = this.peek();
        return token.type === 'symbol' && token.text === text;
    }

    private eatSymbol(text: string): boolean {
        return this.isSymbol(text) && this.advance();
    }

    private peekClose(delimiter: Delimiter): boolean {
        const token = this.peek();
        return token.type === 'close' && token.delimiter === delimiter;
    }

    private expectClose(delimiter: Delimiter): void {
        if (!this.peekClose(delimiter)) {
            throw this.error(`Expected a closing '${delimiter === '{' ? '\\}' : delimiter}'`);
        }
        this.advance();
    }

    private expect(type: Token['type'], message: string): void {
        if (this.peek().type !== type) {
            throw this.error(message);
        }
        this.advance();
    }

    private expectEnd(): void {
        if (this.peek().type !== 'end') {
            throw this.error('Unexpected latex after the expression');
        }
    }

    /** From `start` to the end of the last token read. */
    private span(start: number): Span {
        const previous = this.tokens[this.position - 1];
        return { start, end: Math.max(start, previous?.end ?? start) };
    }

    private error(message: string): LatexParseError {
        const token = this.peek();
        const found =
            token.type === 'end' ? 'the end' : `'${this.latex.slice(token.start, token.end)}'`;
        return new LatexParseError(`${message}, found ${found}`, token.start);
    }
}
