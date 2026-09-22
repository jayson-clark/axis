// ═════════════════════════════════════════════════════════════════════════════
// Macros - substituted as trees, so precedence holds by construction
// ═════════════════════════════════════════════════════════════════════════════
//
// Spec §6. Ported from v1's `packages/language/test/macros.test.mts` and the
// harness suite, with the semantics changed: a macro is an expression and
// nothing else, and its arguments keep their own grouping without anybody
// having to bracket them. Whether Desmos evaluates the result as intended is
// the harness's question; what the tree comes out as is this one's.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Expression } from '@axis-dsl/desmos';
import { parseExpression } from '@axis-dsl/syntax';
import { collectSymbols, emitLatex, expandMacros, loadProgram } from '../dist/index.js';
import { compileAxis, only } from './support/compile.mts';

const latexOf = (source: string) => only<Expression>(source).latex;

describe('expanding a macro', () => {
    test('replaces a parameterless macro by its body', () => {
        assert.equal(
            latexOf('macro TAU = 6.28\ny = sin(TAU * x)'),
            'y=\\sin\\left(6.28\\cdot x\\right)',
        );
    });

    test('puts each argument where its parameter was', () => {
        assert.equal(
            latexOf('macro LERP(a, b, t) = a + (b - a) * t\ny = LERP(0, 10, x)'),
            'y=0+\\left(10-0\\right)\\cdot x',
        );
    });

    test('keeps an argument’s grouping without brackets written for it', () => {
        // sin((1 + 2) * x), never sin(1 + 2 * x).
        assert.equal(
            latexOf('macro WAVE(k) = sin(k * x)\ny = WAVE(1 + 2)'),
            'y=\\sin\\left(\\left(1+2\\right)\\cdot x\\right)',
        );
        // (2 · (1 + 2))², the spec's own example.
        assert.equal(
            latexOf('macro double(a) = 2 * a\ny = double(1 + 2) ^ 2'),
            'y=\\left(2\\cdot\\left(1+2\\right)\\right)^{2}',
        );
    });

    test('keeps a juxtaposed number a product', () => {
        // `2n` with `n` given as `1` is two, not twenty-one.
        assert.equal(latexOf('macro D(n) = 2n\ny = D(1)'), 'y=2\\cdot1');
    });

    test('is in scope above its definition', () => {
        assert.equal(latexOf('y = TAU\nmacro TAU = 6.28'), 'y=6.28');
    });

    test('expands a macro inside a macro, and inside an argument', () => {
        assert.equal(
            latexOf('macro TAU = 6.28\nmacro HALF(v) = v / 2\ny = HALF(TAU)'),
            'y=\\frac{6.28}{2}',
        );
        assert.equal(
            latexOf('macro TWO = 2\nmacro TWICE(v) = TWO * v\ny = TWICE(TWO)'),
            'y=2\\cdot2',
        );
    });

    test('stands for a whole equation, which is then a statement', () => {
        assert.equal(
            latexOf('macro CIRCLE(radius) = x ^ 2 + y ^ 2 = radius ^ 2\nCIRCLE(3) @ color: RED'),
            'x^{2}+y^{2}=3^{2}',
        );
    });

    test('stands for an action run', () => {
        const { state } = compileAxis('macro RESET = a -> 0, b -> 0\n(1, 1) @ onClick: RESET');
        const point = state.expressions?.list?.[0] as Expression;
        assert.equal(point.clickableInfo?.latex, 'a\\to0,b\\to0');
    });

    test('expands in a ticker, a table, a slider and a colour', () => {
        const { state } = compileAxis(
            [
                'macro STEP(v) = v -> v + 1',
                'macro ROW = 3',
                'macro TOP = 10',
                'macro HUE = hsv(120, 1, 1)',
                'ticker STEP(a)',
                'table { x = [1, 2, ROW] }',
                'a = 1 @ slider: 0..TOP',
                'y = x @ color: HUE',
            ].join('\n'),
        );
        const [table, slider, line] = state.expressions?.list ?? [];

        assert.equal(state.expressions?.ticker?.handlerLatex, 'a\\to a+1');
        assert.deepEqual((table as { columns: { values: string[] }[] }).columns[0].values, [
            '1',
            '2',
            '3',
        ]);
        assert.equal((slider as Expression).slider?.max, '10');
        assert.equal((line as Expression).colorLatex, '\\operatorname{hsv}\\left(120,1,1\\right)');
    });

    test('renames a parameter called as a function', () => {
        assert.equal(
            latexOf('macro APPLY(g, v) = g(v)\nf(x) = x\ny = APPLY(f, 2)'),
            'y=f\\left(2\\right)',
        );
    });

    test('leaves a macro name inside a note as the word it is', () => {
        const { state } = compileAxis('macro TAU = 6.28\n"TAU is a macro"');
        assert.equal((state.expressions?.list?.[0] as { text?: string }).text, 'TAU is a macro');
    });

    test('leaves a use it cannot expand as it was written', () => {
        // Reported, and harmless: the graph gets the name.
        assert.equal(latexOf('macro W(k) = k\ny = W(1, 2)'), 'y=W\\left(1,2\\right)');
        assert.doesNotThrow(() => compileAxis('macro A = B\nmacro B = A\ny = A'));
    });
});

describe('expandMacros', () => {
    const macros = (source: string) => collectSymbols(loadProgram(source)).symbols.macros;

    test('hands back the very same tree when there is nothing to expand', () => {
        const { expression } = parseExpression('a + b * c');
        const expansion = expandMacros(expression, macros('macro Q = 1'));

        assert.equal(expansion.expression, expression);
        assert.equal(expansion.expanded, false);
    });

    test('says when it expanded something', () => {
        const { expression } = parseExpression('Q + 1');
        const expansion = expandMacros(expression, macros('macro Q = 2'));

        assert.equal(expansion.expanded, true);
        assert.equal(emitLatex(expansion.expression), '2+1');
    });

    test('leaves the macro’s own body untouched', () => {
        const table = macros('macro F(v) = v + 1');
        const body = table.get('F')!.body;
        const before = JSON.stringify(body);

        expandMacros(parseExpression('F(2) + F(3)').expression, table);
        assert.equal(JSON.stringify(body), before);
    });
});
