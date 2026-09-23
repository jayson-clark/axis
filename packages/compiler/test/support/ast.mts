// ═════════════════════════════════════════════════════════════════════════════
// Building expression trees by hand
// ═════════════════════════════════════════════════════════════════════════════
//
// The latex emitter and parser are tested against trees, and the Axis parser
// that would otherwise make them is being written alongside - so the tests
// build their own. Every builder takes a number or a string where it takes an
// operand, as shorthand for a number literal or an identifier, so a case reads
// close to the expression it stands for: `div(1, imp(2, 'x'))`.
//
// Also here: a way to compare two trees for what they mean rather than where
// they were read from, and a reference evaluator the harness suite checks
// Desmos against.

import type {
    Binding,
    ComparisonOperator,
    Expression,
    Identifier,
    PiecewiseBranch,
    Span,
} from '@axis-dsl/syntax';

// For the harness suite, which has no dependency on the syntax package of its
// own and builds its trees here.
export type { Expression } from '@axis-dsl/syntax';

const SPAN: Span = { start: 0, end: 0 };

/** An operand: a tree, or a number or name standing for one. */
export type Operand = Expression | number | string;

export function node(operand: Operand): Expression {
    if (typeof operand === 'number') {
        return num(operand);
    }
    if (typeof operand === 'string') {
        return /^[0-9.]/.test(operand) ? num(operand) : id(operand);
    }
    return operand;
}

export const num = (value: number | string): Expression => ({
    kind: 'Number',
    value: String(value),
    span: SPAN,
});
export const id = (name: string): Identifier => ({ kind: 'Identifier', name, span: SPAN });
export const str = (value: string): Expression => ({ kind: 'String', value, span: SPAN });
export const color = (value: string): Expression => ({ kind: 'Color', value, span: SPAN });

export const paren = (expression: Operand): Expression => ({
    kind: 'Paren',
    expression: node(expression),
    span: SPAN,
});
export const tuple = (...elements: Operand[]): Expression => ({
    kind: 'Tuple',
    elements: elements.map(node),
    span: SPAN,
});
export const list = (...elements: Operand[]): Expression => ({
    kind: 'List',
    elements: elements.map(node),
    span: SPAN,
});
export const range = (from: Operand, to: Operand): Expression => ({
    kind: 'ListRange',
    from: node(from),
    to: node(to),
    span: SPAN,
});
export const abs = (expression: Operand): Expression => ({
    kind: 'Abs',
    expression: node(expression),
    span: SPAN,
});

/** `{c: v, c: v, otherwise}`: a branch is `[condition, value]`, value null for a bare one. */
export const piecewise = (
    branches: [Operand, Operand | null][],
    otherwise: Operand | null = null,
): Expression => ({
    kind: 'Piecewise',
    branches: branches.map(([condition, value]): PiecewiseBranch => ({
        kind: 'PiecewiseBranch',
        condition: node(condition),
        value: value === null ? null : node(value),
        span: SPAN,
    })),
    otherwise: otherwise === null ? null : node(otherwise),
    span: SPAN,
});

export const neg = (operand: Operand): Expression => ({
    kind: 'Unary',
    operator: '-',
    operand: node(operand),
    span: SPAN,
});
export const pos = (operand: Operand): Expression => ({
    kind: 'Unary',
    operator: '+',
    operand: node(operand),
    span: SPAN,
});

type BinaryOperator = '+' | '-' | '*' | '/' | '^' | 'implicit';

export const binary = (operator: BinaryOperator, left: Operand, right: Operand): Expression => ({
    kind: 'Binary',
    operator,
    left: node(left),
    right: node(right),
    span: SPAN,
});
export const add = (a: Operand, b: Operand) => binary('+', a, b);
export const sub = (a: Operand, b: Operand) => binary('-', a, b);
export const mul = (a: Operand, b: Operand) => binary('*', a, b);
export const div = (a: Operand, b: Operand) => binary('/', a, b);
export const pow = (a: Operand, b: Operand) => binary('^', a, b);

/** Juxtaposition, folded to the left as the parser would: `imp(2, 'pi', 'x')` is `2pi x`. */
export const imp = (first: Operand, ...rest: Operand[]): Expression =>
    rest.reduce<Expression>((left, right) => binary('implicit', left, right), node(first));

/** `cmp('a', '<', 'x', '<=', 'b')` - operands and operators alternating. */
export const cmp = (...parts: (Operand | ComparisonOperator)[]): Expression => ({
    kind: 'Comparison',
    operands: parts.filter((_, index) => index % 2 === 0).map(part => node(part as Operand)),
    operators: parts.filter((_, index) => index % 2 === 1) as ComparisonOperator[],
    span: SPAN,
});
export const eq = (a: Operand, b: Operand) => cmp(a, '=', b);

export const call = (name: string, ...args: Operand[]): Expression => ({
    kind: 'Call',
    callee: id(name),
    arguments: args.map(node),
    span: SPAN,
});
export const index = (target: Operand, at: Operand): Expression => ({
    kind: 'Index',
    target: node(target),
    index: node(at),
    span: SPAN,
});
export const member = (target: Operand, name: string): Expression => ({
    kind: 'Member',
    target: node(target),
    name: id(name),
    span: SPAN,
});
export const fact = (operand: Operand): Expression => ({
    kind: 'Factorial',
    operand: node(operand),
    span: SPAN,
});
export const act = (target: Operand, value: Operand): Expression => ({
    kind: 'Action',
    target: node(target),
    value: node(value),
    span: SPAN,
});
export const seq = (...elements: Operand[]): Expression => ({
    kind: 'Sequence',
    elements: elements.map(node),
    span: SPAN,
});

const bindings = (pairs: [string, Operand][]): Binding[] =>
    pairs.map(([name, value]) => ({
        kind: 'Binding',
        name: id(name),
        value: node(value),
        span: SPAN,
    }));

export const withB = (body: Operand, ...pairs: [string, Operand][]): Expression => ({
    kind: 'With',
    body: node(body),
    bindings: bindings(pairs),
    span: SPAN,
});
export const forB = (body: Operand, ...pairs: [string, Operand][]): Expression => ({
    kind: 'For',
    body: node(body),
    bindings: bindings(pairs),
    span: SPAN,
});

// ─────────────────────────────────────────────────────────────────────────────
// Comparing trees
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `tree` without its spans, and without the `Paren` nodes: a copy that says
 * what the expression is and not how it was bracketed or where it came from.
 */
export function shape(tree: unknown, keepParens = false): unknown {
    if (Array.isArray(tree)) {
        return tree.map(item => shape(item, keepParens));
    }
    if (tree === null || typeof tree !== 'object') {
        return tree;
    }
    const record = tree as Record<string, unknown>;
    if (!keepParens && record.kind === 'Paren') {
        return shape(record.expression, keepParens);
    }
    return Object.fromEntries(
        Object.entries(record)
            .filter(([key]) => key !== 'span')
            .map(([key, value]) => [key, shape(value, keepParens)]),
    );
}

/** A fully bracketed rendering of a tree, for a failure message a person can read. */
export function show(tree: Expression): string {
    switch (tree.kind) {
        case 'Number':
            return tree.value;
        case 'Identifier':
            return tree.name;
        case 'String':
            return JSON.stringify(tree.value);
        case 'Color':
            return tree.value;
        case 'Paren':
            return `paren(${show(tree.expression)})`;
        case 'Tuple':
            return `tuple(${tree.elements.map(show).join(', ')})`;
        case 'List':
            return `[${tree.elements.map(show).join(', ')}]`;
        case 'ListRange':
            return `${show(tree.from)}...${show(tree.to)}`;
        case 'Piecewise':
            return `{${[
                ...tree.branches.map(b =>
                    b.value ? `${show(b.condition)}: ${show(b.value)}` : show(b.condition),
                ),
                ...(tree.otherwise ? [show(tree.otherwise)] : []),
            ].join(', ')}}`;
        case 'Abs':
            return `|${show(tree.expression)}|`;
        case 'Unary':
            return `(${tree.operator}${show(tree.operand)})`;
        case 'Binary':
            return `(${show(tree.left)} ${tree.operator === 'implicit' ? '·' : tree.operator} ${show(tree.right)})`;
        case 'Comparison':
            return `(${tree.operands.map((o, i) => (i ? `${tree.operators[i - 1]} ` : '') + show(o)).join(' ')})`;
        case 'Call':
            return `${tree.callee.name}(${tree.arguments.map(show).join(', ')})`;
        case 'Index':
            return `${show(tree.target)}[${show(tree.index)}]`;
        case 'Member':
            return `${show(tree.target)}.${tree.name.name}`;
        case 'Factorial':
            return `${show(tree.operand)}!`;
        case 'Action':
            return `(${show(tree.target)} -> ${show(tree.value)})`;
        case 'Sequence':
            return `seq(${tree.elements.map(show).join(', ')})`;
        case 'With':
        case 'For':
            return `(${show(tree.body)} ${tree.kind.toLowerCase()} ${tree.bindings
                .map(b => `${b.name.name} = ${show(b.value)}`)
                .join(', ')})`;
        case 'ErrorExpression':
            return '<error>';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// A reference evaluator
// ─────────────────────────────────────────────────────────────────────────────

const CONSTANTS: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E };

/**
 * Desmos gives the trig functions exact zeros at multiples of π, where doubles
 * leave 1e-16 behind: `sin(π)` is 0 to it. That residue is harmless until a
 * cube root turns it into 5e-6, so the evaluator snaps it the same way.
 */
const exactZero =
    (fn: (x: number) => number) =>
    (x: number): number => {
        const value = fn(x);
        return Math.abs(value) < 1e-12 ? 0 : value;
    };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
    sin: exactZero(Math.sin),
    cos: exactZero(Math.cos),
    tan: exactZero(Math.tan),
    exp: Math.exp,
    ln: Math.log,
    log: Math.log10,
    sqrt: Math.sqrt,
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    max: Math.max,
    min: Math.min,
    // Desmos' mod takes the sign of the divisor.
    mod: (a, b) => a - b * Math.floor(a / b),
    // An odd root of a negative number is real, as Desmos has it.
    nthroot: (x, n) =>
        x < 0 && Number.isInteger(n) && n % 2 !== 0 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n),
};

/**
 * What a numeric tree evaluates to, by the reading spec §5.1 gives it -
 * independently of any latex, which is the point: the harness asks Desmos the
 * same question of the emitted latex and expects this answer.
 *
 * NaN for anything outside arithmetic, and for a name `scope` does not hold.
 */
export function evaluate(tree: Expression, scope: Record<string, number> = {}): number {
    const at = (child: Expression) => evaluate(child, scope);

    switch (tree.kind) {
        case 'Number':
            return Number(tree.value);
        case 'Identifier':
            return scope[tree.name] ?? CONSTANTS[tree.name] ?? NaN;
        case 'Paren':
            return at(tree.expression);
        case 'Abs':
            return Math.abs(at(tree.expression));
        case 'Unary':
            return tree.operator === '-' ? -at(tree.operand) : at(tree.operand);
        case 'Factorial': {
            const n = at(tree.operand);
            if (!Number.isInteger(n) || n < 0 || n > 20) {
                return NaN;
            }
            let product = 1;
            for (let i = 2; i <= n; i++) product *= i;
            return product;
        }
        case 'Binary': {
            const left = at(tree.left);
            const right = at(tree.right);
            switch (tree.operator) {
                case '+':
                    return left + right;
                case '-':
                    return left - right;
                case '*':
                case 'implicit':
                    return left * right;
                case '/':
                    return left / right;
                case '^':
                    return Math.pow(left, right);
            }
            break;
        }
        case 'Call': {
            const fn = FUNCTIONS[tree.callee.name];
            return fn ? fn(...tree.arguments.map(at)) : NaN;
        }
    }
    return NaN;
}
