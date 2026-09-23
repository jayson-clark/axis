// ═════════════════════════════════════════════════════════════════════════════
// Macros, checked against the graph they expand into
// ═════════════════════════════════════════════════════════════════════════════
//
// A macro is an expression with a name, substituted into the syntax tree
// wherever it is used (spec §6). The compiler's own tests pin the tree that
// comes out; what a calculator is needed for is the arithmetic on the other
// side of it. An expansion that compiles cleanly and evaluates to the wrong
// number looks exactly like one that does not, right up until something asks
// Desmos for the value.
//
// Which is the whole risk of substitution. `macro double(a) = 2 * a` used as
// `double(1 + 2) ^ 2` is a valid graph whatever the grouping; it is 36, 16 or
// 6, and only one of those is what the author wrote.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Expression } from '@axis-dsl/desmos';
import { compileAxis, type CompileOptions } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';

describe('macros', { skip }, () => {
    const calculator = useCalculator();

    /**
     * Load `source`, which has to be clean and a graph Desmos accepts, and read
     * what Desmos makes of the Axis expression `of`.
     */
    const value = async (source: string, of: string, options?: CompileOptions) => {
        const { diagnostics } = await calculator().load(source, options);
        assert.deepEqual(
            diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`),
            [],
        );
        assert.deepEqual(await calculator().getErrors(), []);
        return (await calculator().evaluate(of)).numericValue;
    };

    const near = (actual: number, expected: number) =>
        assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

    test('a macro without parameters is the expression it stands for', async () => {
        near(await value('macro TAU = 6.28\nc = TAU / 2', 'c'), 3.14);
    });

    test('a call puts its arguments where the body says', async () => {
        const source = 'macro LERP(a, b, t) = a + (b - a) * t\nm = LERP(10, 20, 0.25)';
        assert.equal(await value(source, 'm'), 12.5);
    });

    test('an argument keeps the grouping it was written with', async () => {
        // Substituted as a tree, `1 + 2` stays one operand: (2 · (1 + 2))² is
        // 36. With the body bracketed and the argument not it would be
        // (2 · 1 + 2)² = 16, and spliced in as bare text 2 · 1 + 2² = 6.
        assert.equal(await value('macro double(a) = 2 * a\nq = double(1 + 2) ^ 2', 'q'), 36);
    });

    test('a body keeps its own grouping where it is used', async () => {
        // `2 * SUM(1, 2)` is 2 · (1 + 2), not 2 · 1 + 2.
        assert.equal(await value('macro SUM(a, b) = a + b\nq = 2 * SUM(1, 2)', 'q'), 6);
        assert.equal(await value('macro SUM(a, b) = a + b\nq = SUM(1, 2) ^ 2', 'q'), 9);
        assert.equal(await value('macro NEG = -3\nq = NEG ^ 2', 'q'), 9);
    });

    test('a macro against a coefficient multiplies rather than merges', async () => {
        // `2TAU` spliced as text is `26.28`.
        near(await value('macro TAU = 6.28\nc = 2TAU', 'c'), 12.56);
    });

    test('a macro may use another', async () => {
        const source = 'macro TAU = 2pi\nmacro TURN(k) = k * TAU\nc = TURN(0.5)';
        near(await value(source, 'c'), Math.PI);
    });

    test('a macro is in scope above the line that defines it', async () => {
        assert.equal(await value('c = LATER + 1\nmacro LATER = 41', 'c'), 42);
    });

    test('a parameter shadows a variable of the same name', async () => {
        assert.equal(await value('k = 100\nmacro SCALE(k) = 2k\nc = SCALE(3)', 'c'), 6);
    });

    test('a macro reaching a graph is a macro Desmos never sees', async () => {
        await value('macro TAU = 6.28\ny = sin(TAU * x)', '0');
        const [expression] = await calculator().inspectExpressions();

        assert.equal(expression.latex, 'y=\\sin\\left(6.28\\cdot x\\right)');
        assert.equal(expression.analysis?.isGraphable, true);
    });

    test('a body may be a whole equation, which then graphs', async () => {
        await value('macro CIRCLE(radius) = x ^ 2 + y ^ 2 = radius ^ 2\nCIRCLE(2)', '0');
        const [circle] = await calculator().inspectExpressions();

        assert.equal(circle.latex, 'x^{2}+y^{2}=2^{2}');
        assert.equal(circle.analysis?.isGraphable, true);
    });

    test('a macro expands in a metadata value too', async () => {
        await value(
            'macro WIDE = 5\nmacro TOP = 8\na = 1 @ slider: 0..TOP\ny = a * x @ lineWidth: WIDE',
            'a',
        );
        const [slider, curve] = ((await calculator().getState()).expressions?.list ??
            []) as Expression[];

        assert.equal(slider.slider?.max, '8');
        assert.equal(curve.lineWidth, '5');
    });

    test('a macro expands into an action the ticker then runs', async () => {
        await value('macro bump(v) = v -> v + 1\na = 0\nticker bump(a) @ minStep: 0, playing', 'a');
        await new Promise(resolve => setTimeout(resolve, 400));

        assert.ok((await calculator().evaluate('a')).numericValue > 0, 'the ticker never ticked');
    });

    test('a macro written for a ticker may use dt', async () => {
        // A macro's body is checked where it is written, and `dt` is allowed
        // there, since a macro may be meant for a handler (spec §6).
        await value(
            'macro ADVANCE = t -> t + dt\nt = 0\nticker ADVANCE @ minStep: 20, playing',
            't',
        );
        await new Promise(resolve => setTimeout(resolve, 400));

        assert.ok((await calculator().evaluate('t')).numericValue > 0, 'dt never added up');
    });

    test('a macro defined in an import is in scope in the file, and back', async () => {
        const options: CompileOptions = {
            path: '/graph.axis',
            resolveImport: () => ({
                path: '/lib.axis',
                source: 'macro HALF(v) = v / 2\nfromLib = HALF(BASE)',
            }),
        };

        assert.equal(await value('import "lib"\nmacro BASE = 10\nc = HALF(8)', 'c', options), 4);
        assert.equal((await calculator().evaluate('fromLib')).numericValue, 5);
    });

    test('a macro named after a builtin is left out, and the builtin keeps its meaning', async () => {
        const { diagnostics } = await calculator().load('macro sin = 1\na = sin(0)');

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['macro-collision'],
        );
        assert.equal((await calculator().evaluate('a')).numericValue, 0);
    });

    test('a macro named after a variable is left out, and the variable keeps its meaning', async () => {
        const { diagnostics } = await calculator().load('k = 4\nmacro k = 1\na = k + 1');

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['macro-collision'],
        );
        assert.equal((await calculator().evaluate('a')).numericValue, 5);
    });

    test('a statement a macro expanded into is not written back', () => {
        // The graph holds the expansion, not the call, so writing the graph
        // back over the statement would lose the macro (spec §6).
        const { sourceMap, state } = compileAxis('macro TAU = 6.28\nc = TAU\nd = 1');
        const [c, d] = state.expressions?.list ?? [];

        assert.equal(sourceMap.get(c.id!)?.writable, false);
        assert.equal(sourceMap.get(d.id!)?.writable, true);
    });
});
