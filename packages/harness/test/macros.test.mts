// ═════════════════════════════════════════════════════════════════════════════
// Macros, checked against the graph they expand into
// ═════════════════════════════════════════════════════════════════════════════
//
// Nothing here is about the substitution itself — that is text, and the
// compiler's own tests pin it character for character. What a calculator is
// needed for is the arithmetic on the other side of it: an expansion that
// compiles cleanly and evaluates to the wrong number looks exactly like one
// that does not, right up until something asks Desmos for the value.
//
// Which is the whole risk in a preprocessor. `macro DOUBLE(x) 2 * x` used as
// `DOUBLE(1 + 2) ^ 2` is a valid graph either way; it is either 36 or 25.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { skip, useCalculator } from './support.mts';

describe('macros', { skip }, () => {
    const calculator = useCalculator();

    /** Load `source` and read what Desmos makes of the Axis expression `of`. */
    const value = async (source: string, of: string): Promise<number | undefined> => {
        await calculator().load(source);
        assert.deepEqual(await calculator().getErrors(), []);
        return (await calculator().evaluate(of)).numericValue;
    };

    test('an object-like macro is the text it stands for', async () => {
        assert.equal(await value('macro TAU 6.28\nc = TAU / 2', 'c'), 3.14);
    });

    test('a call puts its arguments where the body says', async () => {
        const source = 'macro LERP(a, b, t) a + (b - a) * t\nm = LERP(10, 20, 0.25)';
        assert.equal(await value(source, 'm'), 12.5);
    });

    test('an argument keeps the precedence it was written with', async () => {
        // The reason expansions are bracketed: spliced in bare this is
        // 2 * 1 + 2 = 4, and squared it is a different graph again.
        assert.equal(await value('macro D(x) 2 * x\nq = D(1 + 2) ^ 2', 'q'), 36);
    });

    test('a macro spliced against a coefficient multiplies rather than merges', async () => {
        // `2TAU` written out is `26.28` unless something brackets the body.
        assert.equal(await value('macro TAU 6.28\nc = 2TAU', 'c'), 12.56);
    });

    test('a macro reaching a graph is a macro Desmos never sees', async () => {
        await calculator().load('macro TAU 6.28\ny = sin(TAU * x)');

        const [expression] = await calculator().inspectExpressions();
        assert.equal(expression.latex, 'y=\\sin\\left(6.28\\cdot x\\right)');
        assert.equal(expression.analysis?.isGraphable, true);
    });

    test('a macro expands into an action the ticker then runs', async () => {
        await calculator().load(
            'macro STEP(v) v -> v + 1\na = 0\nticker STEP(a) # minStep: 0, playing: true',
        );

        assert.deepEqual(await calculator().getErrors(), []);
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.ok(((await calculator().evaluate('a')).numericValue ?? 0) > 0, 'the ticker ticked');
    });
});
