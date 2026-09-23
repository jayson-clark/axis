// ═════════════════════════════════════════════════════════════════════════════
// Expressions, evaluated by the calculator they are written for
// ═════════════════════════════════════════════════════════════════════════════
//
// The latex emitter is precedence-correct by construction - but "correct"
// means Desmos reads the latex as the tree means it, and only Desmos can say
// whether it does. v1 wrote every one of the cases below as valid latex with a
// different value: `2^10` came out 0, `4^2/2` came out 4. Nothing short of a
// calculator notices that.
//
// So each tree is emitted, handed to a real calculator, and its value compared
// with what a plain JS evaluator of the same tree makes of it
// (`packages/compiler/test/support/ast.mts`). The table is the cases worth
// naming; the random trees after it are everything else.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { emitLatex } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';
import {
    abs,
    act,
    add,
    call,
    deriv,
    div,
    evaluate,
    type Expression,
    fact,
    id,
    imp,
    integral,
    mul,
    neg,
    num,
    paren,
    pow,
    prod,
    show,
    sub,
    sum,
} from '../../compiler/test/support/ast.mts';
import { NUMERIC_SCOPE, numeric, seeded } from '../../compiler/test/support/generate.mts';

/** Whether two values agree to the precision two float evaluations can. */
function agree(actual: number, expected: number): boolean {
    return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

describe('expressions in a real calculator', { skip }, () => {
    const calculator = useCalculator();

    before(async () => {
        await calculator().setExpressions(
            Object.entries(NUMERIC_SCOPE).map(([name, value]) => ({
                type: 'expression' as const,
                id: name,
                latex: `${name}=${value}`,
            })),
        );
    });

    /** What Desmos makes of the tree's latex. */
    const desmos = async (tree: Expression): Promise<number> =>
        (await calculator().evaluateLatex(emitLatex(tree))).numericValue;

    const { a, b, c, n } = NUMERIC_SCOPE;

    // Each with the value it has to come to, written out, as well as the
    // evaluator's - so a mistake in the evaluator cannot hide one in the
    // emitter.
    const table: [string, Expression, number][] = [
        // The v1 regressions.
        ['2^10', pow(2, 10), 1024],
        ['4^2/2', div(pow(4, 2), 2), 8],
        ['a/a^2', div('a', pow('a', 2)), 1 / a],
        ['2^-1', pow(2, neg(1)), 0.5],
        // The consequences in spec §5.1.
        ['1/2a', imp(div(1, 2), 'a'), a / 2],
        ['-a^2', neg(pow('a', 2)), -(a ** 2)],
        ['a/b/c', div(div('a', 'b'), 'c'), a / b / c],
        ['1/-a', div(1, neg('a')), -1 / a],
        ['2^3^2', pow(2, pow(3, 2)), 512],
        ['(2^3)^2', pow(pow(2, 3), 2), 64],
        ['a/b^2', div('a', pow('b', 2)), a / b ** 2],
        ['a^2/b', div(pow('a', 2), 'b'), a ** 2 / b],
        ['-a^-b', neg(pow('a', neg('b'))), -(a ** -b)],
        // Implicit products, and what Desmos would otherwise read instead.
        ['3cos(b)', imp(3, call('cos', 'b')), 3 * Math.cos(b)],
        ['2pi a', imp(2, 'pi', 'a'), 2 * Math.PI * a],
        ['a b', imp('a', 'b'), a * b],
        ['(a)(b)', imp(paren('a'), paren('b')), a * b],
        ['2 3 (not 23)', imp(2, 3), 6],
        ['2 (1/2) (not 2½)', imp(2, div(1, 2)), 1],
        ['2.5 (1/2)', imp(num('2.5'), div(1, 2)), 1.25],
        ['a (-b)', imp('a', neg('b')), -a * b],
        ['a(b), a product', imp('a', paren('b')), a * b],
        ['2^a b', imp(pow(2, 'a'), 'b'), 2 ** a * b],
        ['sin(a) b', imp(call('sin', 'a'), 'b'), Math.sin(a) * b],
        ['n! a', imp(fact('n'), 'a'), 24 * a],
        ['-a b', imp(neg('a'), 'b'), -a * b],
        // Negation beside the other operators.
        ['a * -b', mul('a', neg('b')), -a * b],
        ['a - -b', sub('a', neg('b')), a + b],
        ['--a', neg(neg('a')), a],
        ['(-a)^2', pow(neg('a'), 2), a ** 2],
        ['a - (b - c)', sub('a', sub('b', 'c')), a - (b - c)],
        ['a * (b * c)', mul('a', mul('b', 'c')), a * b * c],
        // The shapes that are not operators.
        ['(1/2)^2', pow(div(1, 2), 2), 0.25],
        ['sqrt(a)^2', pow(call('sqrt', 'a'), 2), a],
        ['nthroot(8, 3)', call('nthroot', 8, 3), 2],
        ['sin(a)^2', pow(call('sin', 'a'), 2), Math.sin(a) ** 2],
        ['|a - b|', abs(sub('a', 'b')), Math.abs(a - b)],
        ['2|-b|', imp(2, abs(neg('b'))), 2 * b],
        ['n!', fact('n'), 24],
        ['x^(n)', pow('a', paren('n')), a ** n],
        ['(a + b)/(c + n)', div(paren(add('a', 'b')), paren(add('c', 'n'))), (a + b) / (c + n)],
        ['max(a, b)', call('max', 'a', 'b'), Math.max(a, b)],
        ['1e-3', num('1e-3'), 0.001],
        ['e^1', pow('e', 1), Math.E],
        ['tau/pi', div('tau', 'pi'), 2],
        // A sum takes the product after it, so what is not its own is kept out.
        ['sum(k = 1..3, k) + 1', add(sum('k', 1, 3, 'k'), 1), 7],
        ['sum(k = 1..3, k) * 2', mul(sum('k', 1, 3, 'k'), 2), 12],
        ['sum(k = 1..3, k) a', imp(sum('k', 1, 3, 'k'), 'a'), 6 * a],
        ['2 sum(k = 1..3, k)', imp(2, sum('k', 1, 3, 'k')), 12],
        ['sum(k = 1..3, k)^2', pow(sum('k', 1, 3, 'k'), 2), 36],
        ['-sum(k = 1..3, k) * 2', mul(neg(sum('k', 1, 3, 'k')), 2), -12],
        ['sum(k = 1..n, k + 1)', sum('k', 1, 'n', add('k', 1)), 14],
        ['sum(k = a - 1..b + 1, k)', sum('k', sub('a', 1), add('b', 1), 'k'), 10],
        ['sum(k = 1..2, sum(j = 1..k, j))', sum('k', 1, 2, sum('j', 1, 'k', 'j')), 4],
        ['prod(k = 1..n, k)', prod('k', 1, 'n', 'k'), 24],
        ['prod(k = 1..3, k) / 2', div(prod('k', 1, 3, 'k'), 2), 3],
        // A logarithm to a base.
        ['log(8, 2)', call('log', 8, 2), 3],
        ['log(a + 7, b)', call('log', add('a', 7), 'b'), 2],
        ['log(8, 2)^2', pow(call('log', 8, 2), 2), 9],
    ];

    for (const [name, tree, expected] of table) {
        test(`${name}: ${emitLatex(tree)}`, async () => {
            assert.ok(agree(evaluate(tree, NUMERIC_SCOPE), expected), 'the evaluator disagrees');
            const actual = await desmos(tree);
            assert.ok(agree(actual, expected), `Desmos says ${actual}, not ${expected}`);
        });
    }

    // Integrals and derivatives, which the evaluator leaves to Desmos: the
    // value each has to come to is written out, and Desmos' integral is a
    // numerical one, so it is held to what that can promise.
    const calculus: [string, Expression, number][] = [
        ['int(t = 0..1, t^2)', integral('t', 0, 1, pow('t', 2)), 1 / 3],
        ['int(t = 0..1, t + 1)', integral('t', 0, 1, add('t', 1)), 1.5],
        ['int(t = 0..1, t) * 3', mul(integral('t', 0, 1, 't'), 3), 1.5],
        ['int(t = 0..1, t) a', imp(integral('t', 0, 1, 't'), 'a'), a / 2],
        ['int(t = 0..1, 2)^2', pow(integral('t', 0, 1, 2), 2), 4],
        ['int(t = 0..b, t)', integral('t', 0, 'b', 't'), b ** 2 / 2],
        [
            'int(s = 0..1, int(t = 0..1, s t))',
            integral('s', 0, 1, integral('t', 0, 1, imp('s', 't'))),
            0.25,
        ],
        ['d/da a^3', deriv('a', pow('a', 3)), 3 * a ** 2],
        ['d/da a^2 + 1', add(deriv('a', pow('a', 2)), 1), 2 * a + 1],
        ['(d/da a^2) * a', mul(deriv('a', pow('a', 2)), 'a'), 2 * a * a],
        ['d/da 3a^2', deriv('a', imp(3, pow('a', 2))), 6 * a],
        ['d/da (a^2 + a)', deriv('a', add(pow('a', 2), 'a')), 2 * a + 1],
        ['2 d/da a^2', imp(2, deriv('a', pow('a', 2))), 4 * a],
        ['d/da d/da a^3', deriv('a', deriv('a', pow('a', 3))), 6 * a],
        ['d/da sum(k = 1..2, a^k)', deriv('a', sum('k', 1, 2, pow('a', 'k'))), 1 + 2 * a],
    ];

    for (const [name, tree, expected] of calculus) {
        test(`${name}: ${emitLatex(tree)}`, async () => {
            const actual = await desmos(tree);
            assert.ok(
                Math.abs(actual - expected) <= 1e-7 * Math.max(1, Math.abs(expected)),
                `Desmos says ${actual}, not ${expected}`,
            );
        });
    }

    const TREES = 500;

    test(`${TREES} random trees evaluate as their tree says`, async () => {
        const failures: string[] = [];
        let compared = 0;

        for (let seed = 1; seed <= TREES; seed++) {
            const tree = numeric(seeded(seed));
            const expected = evaluate(tree, NUMERIC_SCOPE);

            // Where the answer is not an ordinary number, the two evaluations
            // have nothing sensible to agree on: an odd root of a negative, a
            // division by zero, something past where doubles stay honest.
            if (!Number.isFinite(expected) || Math.abs(expected) > 1e6) {
                continue;
            }

            compared++;
            const actual = await desmos(tree);
            if (!agree(actual, expected)) {
                failures.push(
                    `seed ${seed}: ${show(tree)}\n    ${emitLatex(tree)}\n    Desmos ${actual}, expected ${expected}`,
                );
            }
        }

        assert.deepEqual(failures, []);
        // A generator that stopped producing comparable trees would pass
        // vacuously, so it has to have been tested on most of them.
        assert.ok(compared > TREES / 2, `only ${compared} trees were comparable`);
    });
});

describe('dt in a ticker handler (issue #11)', { skip }, () => {
    const calculator = useCalculator();

    /** How far `n` has got after its ticker has run for a moment. */
    const advanced = async (handler: Expression): Promise<number> => {
        await calculator().setExpressions(
            [{ type: 'expression', id: 'n', latex: 'n=0' }],
            { actions: true },
            undefined,
            undefined,
            { handlerLatex: emitLatex(handler), playing: true, open: true },
        );
        await new Promise(resolve => setTimeout(resolve, 500));
        return (await calculator().evaluateLatex('n')).numericValue;
    };

    test('is the milliseconds since the last tick, spelled \\operatorname{dt}', async () => {
        const handler = act('n', add('n', 'dt'));
        assert.equal(emitLatex(handler), 'n\\to n+\\operatorname{dt}');
        // Half a second of ticking at the very least - the load itself waits.
        assert.ok((await advanced(handler)) >= 400);
    });

    test('never advances spelled as the letters, which are d times t', async () => {
        const handler = act('n', add('n', imp('d', 't')));
        assert.equal(emitLatex(handler), 'n\\to n+dt');
        assert.equal(await advanced(handler), 0);
    });

    test('is its own name, not d times t, in the tree', () => {
        assert.equal(emitLatex(id('dt')), '\\operatorname{dt}');
    });
});
