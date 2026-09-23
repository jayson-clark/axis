// ═════════════════════════════════════════════════════════════════════════════
// Random expression trees, reproducibly
// ═════════════════════════════════════════════════════════════════════════════
//
// Two generators over one seeded source of randomness, so a failure names a
// seed and can be run again exactly:
//
//   - `expression` covers the whole tree, for the latex round trip. It makes
//     only trees the Axis parser could have made - see `productRight` for the
//     one place that is a real restriction rather than a matter of taste.
//   - `numeric` makes arithmetic the reference evaluator understands, and makes
//     it without any such restriction, since what is being checked there is
//     what Desmos computes, however the latex reads.

import type { Expression } from '@axis-dsl/syntax';
import {
    abs,
    act,
    add,
    bigOp,
    binary,
    call,
    deriv,
    cmp,
    div,
    eq,
    fact,
    forB,
    id,
    imp,
    index,
    list,
    member,
    mul,
    neg,
    num,
    paren,
    piecewise,
    pos,
    pow,
    prime,
    range,
    seq,
    sub,
    tuple,
    withB,
} from './ast.mts';

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

// ─────────────────────────────────────────────────────────────────────────────
// The whole language
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Names in the spelling the parser gives back, so a round trip compares them
 * exactly: `x_1` rather than `x1`, which is the same latex.
 */
const NAMES = [
    'x',
    'y',
    'a',
    'b',
    'n',
    't',
    'L',
    'amp',
    'x_1',
    'L_1',
    'theta',
    'theta2',
    'pi',
    'e',
    'dt',
];
const NUMBERS = ['0', '1', '2', '3', '10', '0.5', '3.25', '.5', '100'];
const USER_FUNCTIONS = ['f', 'g', 'wave'];
const MEMBERS = ['x', 'y', 'count', 'max', 'mean'];

export function expression(random: Random, depth = 4): Expression {
    // The forms that live only at the top of a value (spec §5.1 levels 1-2).
    const roll = random();
    if (roll < 0.06) {
        return seq(
            ...Array.from({ length: 2 + Math.floor(random() * 2) }, () =>
                action(random, depth - 1),
            ),
        );
    }
    if (roll < 0.1) {
        return withB(value(random, depth - 1), ...bindingPairs(random, depth - 1));
    }
    if (roll < 0.14) {
        return forB(value(random, depth - 1), ...bindingPairs(random, depth - 1));
    }
    if (roll < 0.18) {
        // A named action, or a named run of them (spec §5.6).
        const run =
            random() < 0.5
                ? action(random, depth - 1)
                : seq(action(random, depth - 1), action(random, depth - 1));
        return eq(id(pick(random, ['R', 'A', 'amp'])), run);
    }
    return value(random, depth);
}

/** Anything below a sequence: an action, a comparison, or arithmetic. */
function value(random: Random, depth: number): Expression {
    const roll = random();
    if (roll < 0.1) return action(random, depth);
    if (roll < 0.25) return comparison(random, depth);
    return arithmetic(random, depth);
}

function action(random: Random, depth: number): Expression {
    return act(id(pick(random, NAMES)), arithmetic(random, depth - 1));
}

function comparison(random: Random, depth: number): Expression {
    const operators = ['=', '<', '<=', '>', '>='] as const;
    const parts: (Expression | (typeof operators)[number])[] = [arithmetic(random, depth - 1)];
    const count = random() < 0.2 ? 2 : 1;
    for (let i = 0; i < count; i++) {
        parts.push(pick(random, operators), arithmetic(random, depth - 1));
    }
    return cmp(...parts);
}

function bindingPairs(random: Random, depth: number): [string, Expression][] {
    return Array.from({ length: 1 + Math.floor(random() * 2) }, (): [string, Expression] => [
        pick(random, ['a', 'n', 'i', 'x_1', 'theta']),
        arithmetic(random, depth - 1),
    ]);
}

function leaf(random: Random): Expression {
    return random() < 0.5 ? num(pick(random, NUMBERS)) : id(pick(random, NAMES));
}

function arithmetic(random: Random, depth: number): Expression {
    if (depth <= 0) {
        return leaf(random);
    }
    const d = depth - 1;
    const roll = Math.floor(random() * 25);

    switch (roll) {
        case 0:
        case 1:
            return leaf(random);
        case 2:
            return add(arithmetic(random, d), arithmetic(random, d));
        case 3:
            return sub(arithmetic(random, d), arithmetic(random, d));
        case 4:
            return mul(arithmetic(random, d), arithmetic(random, d));
        case 5:
            return div(arithmetic(random, d), arithmetic(random, d));
        case 6:
            return pow(arithmetic(random, d), arithmetic(random, d));
        case 7:
        case 8:
            return binary('implicit', arithmetic(random, d), productRight(random, d));
        case 9:
            return random() < 0.8 ? neg(arithmetic(random, d)) : pos(arithmetic(random, d));
        case 10:
            return paren(arithmetic(random, d));
        case 11:
            return abs(arithmetic(random, d));
        case 12:
            return callOf(random, d);
        case 13:
            return tuple(
                ...Array.from({ length: 2 + Math.floor(random() * 2) }, () =>
                    arithmetic(random, d),
                ),
            );
        case 14: {
            const roll = random();
            if (roll < 0.2) {
                return list(forB(arithmetic(random, d), ...bindingPairs(random, d)));
            }
            return list(
                ...Array.from({ length: Math.floor(random() * 4) }, () =>
                    random() < 0.2
                        ? range(arithmetic(random, d), arithmetic(random, d))
                        : arithmetic(random, d),
                ),
            );
        }
        case 15:
            return index(
                pick(random, [id('L'), list(leaf(random), leaf(random)), callOf(random, d)]),
                random() < 0.3
                    ? range(arithmetic(random, d), arithmetic(random, d))
                    : arithmetic(random, d),
            );
        case 16:
            return member(
                pick(random, [id('P'), id('L'), callOf(random, d), paren(arithmetic(random, d))]),
                pick(random, MEMBERS),
            );
        case 17:
            return fact(arithmetic(random, d));
        case 18:
            return piecewiseOf(random, d);
        case 19:
            return bigOp(
                pick(random, ['sum', 'prod', 'int'] as const),
                pick(random, ['n', 'k', 't', 'x_1', 'theta']),
                arithmetic(random, d),
                arithmetic(random, d),
                arithmetic(random, d),
            );
        case 20:
            return deriv(pick(random, ['x', 't', 'amp', 'x_1', 'theta']), arithmetic(random, d));
        case 21:
            return prime(
                pick(random, [...USER_FUNCTIONS, 'sin']),
                1 + Math.floor(random() * 2),
                arithmetic(random, d),
            );
        default:
            return binary('implicit', arithmetic(random, d), productRight(random, d));
    }
}

/**
 * The right-hand factor of a juxtaposition.
 *
 * Never anything whose latex opens with a bracket, because a name followed by
 * a bracket is a call - `a\left(b\right)` - to the latex parser exactly as to
 * the Axis one, and the Axis parser never makes the product that spelling
 * would otherwise stand for. (What the product *means* is not in question:
 * the harness checks that against Desmos with no such restriction.)
 */
function productRight(random: Random, depth: number): Expression {
    const d = depth - 1;
    switch (Math.floor(random() * 9)) {
        case 0:
            return num(pick(random, NUMBERS));
        case 1:
            return callOf(random, d);
        case 2:
            return abs(arithmetic(random, d));
        case 3:
            return pow(
                pick(random, [
                    id(pick(random, NAMES)),
                    num(pick(random, NUMBERS)),
                    callOf(random, d),
                ]),
                arithmetic(random, d),
            );
        case 4:
            return div(arithmetic(random, d), arithmetic(random, d));
        case 5:
            return fact(id(pick(random, NAMES)));
        case 6:
            return piecewiseOf(random, d);
        case 7:
            return list(leaf(random), leaf(random));
        default:
            return id(pick(random, NAMES));
    }
}

function callOf(random: Random, depth: number): Expression {
    const d = depth - 1;
    const arg = () => arithmetic(random, d);
    switch (Math.floor(random() * 8)) {
        case 6:
            return call('log', arg(), arg());
        case 0:
            return call(pick(random, ['sin', 'cos', 'ln', 'floor']), arg());
        case 1:
            return call('sqrt', arg());
        case 2:
            return call('nthroot', arg(), arg());
        case 3:
            return call(pick(random, ['max', 'mean', 'mod']), arg(), arg());
        case 4:
            return call('random');
        default:
            return call(
                pick(random, USER_FUNCTIONS),
                ...Array.from({ length: 1 + Math.floor(random() * 2) }, arg),
            );
    }
}

/**
 * Either every branch has a value, with or without an `otherwise`, or none
 * does and there is no `otherwise`. A mix - a bare condition last after a
 * valued branch - is the same latex as an `otherwise`, and reads back as one.
 */
function piecewiseOf(random: Random, depth: number): Expression {
    const d = depth - 1;
    const count = 1 + Math.floor(random() * 2);
    const condition = () => comparison(random, d);
    if (random() < 0.3) {
        return piecewise(Array.from({ length: count }, () => [condition(), null]));
    }
    const valueOf = () => (random() < 0.15 ? action(random, d) : arithmetic(random, d));
    return piecewise(
        Array.from({ length: count }, () => [condition(), valueOf()]),
        random() < 0.5 ? valueOf() : null,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Arithmetic, for the calculator
// ─────────────────────────────────────────────────────────────────────────────

/** The variables `numeric` uses, and the values the harness defines them as. */
export const NUMERIC_SCOPE: Readonly<Record<string, number>> = { a: 2, b: 3, c: 0.5, n: 4 };

const NUMERIC_NUMBERS = ['1', '2', '3', '5', '7', '10', '0.5', '2.5'];

function numericLeaf(random: Random): Expression {
    const roll = random();
    if (roll < 0.45) return num(pick(random, NUMERIC_NUMBERS));
    if (roll < 0.9) return id(pick(random, Object.keys(NUMERIC_SCOPE)));
    return id('pi');
}

export function numeric(random: Random, depth = 4): Expression {
    if (depth <= 0) {
        return numericLeaf(random);
    }
    const d = depth - 1;

    switch (Math.floor(random() * 18)) {
        case 16: {
            // A sum or a product over a few integers, with the variable in
            // its body - and the body a product or looser, which is where
            // latex is tempted to let it run on.
            // A name of its own at each depth: Desmos will not bind one a sum
            // around this one already has.
            const k = id(['k', 'j', 'm', 'p', 'q'][d % 5]);
            const body = pick(random, [
                () => add(k, numeric(random, d)),
                () => mul(k, numeric(random, d)),
                () => imp(numeric(random, d), k),
                () => pow(k, num('2')),
                () => numeric(random, d),
            ])();
            return bigOp(
                pick(random, ['sum', 'prod'] as const),
                k.name,
                num(pick(random, ['0', '1', '2'])),
                pick(random, [num('3'), id('n'), add(1, 'a')]),
                body,
            );
        }
        case 17:
            return call('log', numeric(random, d), num(pick(random, ['2', '3', '10'])));
        case 0:
            return numericLeaf(random);
        case 1:
            return add(numeric(random, d), numeric(random, d));
        case 2:
            return sub(numeric(random, d), numeric(random, d));
        case 3:
            return mul(numeric(random, d), numeric(random, d));
        case 4:
        case 5:
            return div(numeric(random, d), numeric(random, d));
        case 6:
        case 7:
            // Small exponents, so a result stays in the range worth comparing.
            return pow(numeric(random, d), numeric(random, Math.min(d, 1)));
        case 8:
        case 9:
        case 10:
            return imp(numeric(random, d), numeric(random, d));
        case 11:
            return neg(numeric(random, d));
        case 12:
            return paren(numeric(random, d));
        case 13:
            return abs(numeric(random, d));
        case 14:
            return call(pick(random, ['sin', 'cos', 'sqrt', 'exp']), numeric(random, d));
        default:
            return pick(random, [
                () => call('nthroot', numeric(random, d), num(pick(random, ['2', '3']))),
                () => call('max', numeric(random, d), numeric(random, d)),
                () => fact(num(pick(random, ['3', '4', '5']))),
            ])();
    }
}
