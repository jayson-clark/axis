// ═════════════════════════════════════════════════════════════════════════════
// Trees by hand, and trees at random
// ═════════════════════════════════════════════════════════════════════════════
//
// The printer is tested against trees nobody parsed - which is how the
// decompiler will hand them over, with no brackets in them at all. Every
// builder takes a number or a string where it takes an operand, as shorthand
// for a number literal or a name, so a case reads close to what it stands for:
// `div(1, imp(2, 'x'))`.
//
// The generator makes only trees the parser could have made, give or take
// brackets: whatever it builds, some text reads back as exactly it. The one
// shape that has no text is a run anywhere but the top of a value, since
// `(a -> 1, b -> 2)` is a tuple - so runs are only made there.

import type {
    Binding,
    ComparisonOperator,
    Expression,
    Identifier,
    Metadata,
    PiecewiseBranch,
    Property,
    PropertyValue,
    Range,
    Span,
} from '../dist/index.js';

const SPAN: Span = { start: 0, end: 0 };

export type Operand = Expression | number | string;

export function node(operand: Operand): Expression {
    if (typeof operand === 'number') return num(operand);
    if (typeof operand === 'string') return /^[0-9.]/.test(operand) ? num(operand) : id(operand);
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

export const prime = (name: string, order: number, ...args: Operand[]): Expression => ({
    kind: 'Prime',
    callee: id(name),
    order,
    arguments: args.map(node),
    span: SPAN,
});
export const bigOp = (
    operator: 'sum' | 'prod' | 'int',
    variable: string,
    from: Operand,
    to: Operand,
    body: Operand,
): Expression => ({
    kind: 'BigOperator',
    operator,
    name: id(operator),
    variable: id(variable),
    from: node(from),
    to: node(to),
    body: node(body),
    span: SPAN,
});
export const deriv = (variable: string, body: Operand): Expression => ({
    kind: 'Derivative',
    variable: id(variable),
    body: node(body),
    span: SPAN,
});

// Properties

export const prop = (key: string, value?: PropertyValue | Operand): Property => ({
    kind: 'Property',
    key: id(key),
    colon: value !== undefined,
    value:
        value === undefined
            ? null
            : typeof value === 'object' && value.kind === 'Range'
              ? value
              : node(value as Operand),
    span: SPAN,
});
export const slider = (
    min: Operand | null,
    max: Operand | null,
    step: Operand | null = null,
    soft: Range['soft'] = 'none',
): Range => ({
    kind: 'Range',
    min: min === null ? null : node(min),
    max: max === null ? null : node(max),
    step: step === null ? null : node(step),
    soft,
    span: SPAN,
});
export const meta = (entries: Property[], block = false): Metadata => ({
    kind: 'Metadata',
    block,
    entries,
    span: SPAN,
});

// ─────────────────────────────────────────────────────────────────────────────
// Random trees
// ─────────────────────────────────────────────────────────────────────────────

export type Random = () => number;

/** mulberry32: small, fast, and the same sequence on every machine. */
export function seeded(seed: number): Random {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = <T,>(random: Random, items: readonly T[]): T =>
    items[Math.floor(random() * items.length)];

const count = (random: Random, least: number, most: number) =>
    least + Math.floor(random() * (most - least + 1));

/**
 * Names chosen to make trouble: `e2` and `e` beside a number could be read as
 * an exponent, `x_1` ends in a digit, `min` is a word a range treats specially.
 */
const NAMES = [
    'x',
    'y',
    'a',
    'b',
    'n',
    'L',
    'P',
    'amp',
    'x_1',
    'theta',
    'pi',
    'e',
    'e2',
    'min',
    'dt',
];
const NUMBERS = ['0', '1', '2', '3', '10', '0.5', '.5', '1e-3', '100'];
const FUNCTIONS = ['f', 'sin', 'max', 'polygon'];
const MEMBERS = ['x', 'y', 'count'];

const leaf = (random: Random): Expression => {
    const roll = random();
    if (roll < 0.45) return num(pick(random, NUMBERS));
    if (roll < 0.95) return id(pick(random, NAMES));
    return roll < 0.975 ? str(pick(random, ['a', 'say "hi"', 'back\\slash'])) : color('#c74440');
};

/** A value at the top of a statement: anything, runs included. */
export function statementValue(random: Random, depth = 4): Expression {
    const roll = random();
    if (roll < 0.08)
        return seq(
            ...Array.from({ length: count(random, 2, 3) }, () => runElement(random, depth - 1)),
        );
    if (roll < 0.14) {
        const run =
            random() < 0.5
                ? runElement(random, depth - 1)
                : seq(runElement(random, depth - 1), runElement(random, depth - 1));
        return eq(id(pick(random, ['R', 'A', 'f'])), run);
    }
    if (roll < 0.18) {
        const body =
            random() < 0.5
                ? seq(runElement(random, depth - 1), runElement(random, depth - 1))
                : expression(random, depth - 1);
        return (random() < 0.5 ? withB : forB)(body, ...bindingPairs(random, depth - 1));
    }
    return expression(random, depth);
}

function runElement(random: Random, depth: number): Expression {
    return random() < 0.7
        ? act(id(pick(random, NAMES)), expression(random, depth))
        : expression(random, depth);
}

function bindingPairs(random: Random, depth: number): [string, Expression][] {
    return Array.from({ length: count(random, 1, 2) }, (): [string, Expression] => [
        pick(random, ['a', 'n', 'i', 'x_1']),
        expression(random, depth - 1),
    ]);
}

/** Any expression but a run. */
export function expression(random: Random, depth = 4): Expression {
    if (depth <= 0) return leaf(random);
    const d = depth - 1;
    const sub = () => expression(random, d);

    switch (Math.floor(random() * 29)) {
        case 24:
            return bigOp(
                pick(random, ['sum', 'prod', 'int'] as const),
                pick(random, NAMES),
                sub(),
                sub(),
                sub(),
            );
        case 25:
            return deriv(pick(random, NAMES), sub());
        case 26:
            return prime(
                pick(random, ['f', 'sin']),
                count(random, 1, 3),
                ...Array.from({ length: count(random, 0, 2) }, sub),
            );
        case 0:
        case 1:
            return leaf(random);
        case 2:
            return add(sub(), sub());
        case 3:
            return binary('-', sub(), sub());
        case 4:
            return mul(sub(), sub());
        case 5:
            return div(sub(), sub());
        case 6:
            return pow(sub(), sub());
        case 7:
        case 8:
        case 9:
            return imp(sub(), sub());
        case 10:
            return imp(
                num(pick(random, NUMBERS)),
                pick(random, [id(pick(random, NAMES)), call('sin', sub()), sub()]),
            );
        case 11:
            return random() < 0.8 ? neg(sub()) : pos(sub());
        case 12:
            return abs(sub());
        case 13:
            return call(
                pick(random, FUNCTIONS),
                ...Array.from({ length: count(random, 0, 3) }, sub),
            );
        case 14:
            return tuple(...Array.from({ length: count(random, 1, 3) }, sub));
        case 15: {
            if (random() < 0.2) return list(forB(sub(), ...bindingPairs(random, d)));
            return list(
                ...Array.from({ length: count(random, 0, 3) }, () =>
                    random() < 0.25 ? range(sub(), sub()) : sub(),
                ),
            );
        }
        case 16:
            return index(sub(), random() < 0.3 ? range(sub(), sub()) : sub());
        case 17:
            return member(sub(), pick(random, MEMBERS));
        case 18:
            return fact(sub());
        case 19:
            return piecewiseOf(random, d);
        case 20: {
            const operators = ['=', '<', '<=', '>', '>='] as const;
            const parts: (Expression | ComparisonOperator)[] = [sub()];
            for (let i = count(random, 1, 2); i > 0; i--)
                parts.push(pick(random, operators), sub());
            return cmp(...parts);
        }
        case 21:
            return act(sub(), sub());
        case 22:
            return withB(sub(), ...bindingPairs(random, d));
        case 23:
            return forB(sub(), ...bindingPairs(random, d));
        default:
            return imp(sub(), sub());
    }
}

/**
 * Either every branch has a value, with or without an `otherwise`, or none
 * does and there is no `otherwise`: a bare condition after a valued branch is
 * an `otherwise` however it is built, and reads back as one.
 */
function piecewiseOf(random: Random, depth: number): Expression {
    const n = count(random, 1, 3);
    const sub = () => expression(random, depth);
    if (random() < 0.3) return piecewise(Array.from({ length: n }, () => [sub(), null]));
    return piecewise(
        Array.from({ length: n }, () => [sub(), sub()]),
        random() < 0.5 ? sub() : null,
    );
}
