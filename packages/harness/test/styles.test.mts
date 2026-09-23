// ═════════════════════════════════════════════════════════════════════════════
// Styles, checked against the graph they style
// ═════════════════════════════════════════════════════════════════════════════
//
// A style is a named run of properties that `use:` applies (spec §4.5). It is
// resolved away before anything reaches Desmos - the graph holds the
// properties, not the name - so the question worth a calculator is whether
// what arrives is what the rules say should: styles applied in the order
// written, the clause's own properties over all of them, and a style that uses
// another carrying both. The metadata suite already sends every property
// through a style once; this is about how styles combine.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Expression, Table } from '@axis-dsl/desmos';
import { compileAxis, type CompileOptions } from '@axis-dsl/compiler';
import type { AxisCalculator } from '../dist/index.js';
import { skip, useCalculator } from './support.mts';

/** Load clean source and hand back its applied list. */
async function loadClean(calculator: AxisCalculator, source: string, options?: CompileOptions) {
    const { diagnostics } = await calculator.load(source, options);
    assert.deepEqual(
        diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`),
        [],
        `${source} is not clean`,
    );
    return ((await calculator.getState()).expressions?.list ?? []) as Expression[];
}

describe('styles', { skip }, () => {
    const calculator = useCalculator();

    test('a style used on a statement styles it', async () => {
        const [curve] = await loadClean(
            calculator(),
            'style loud { color: #c74440; lineWidth: 6; lineStyle: DASHED }\ny = x @ use: loud',
        );

        assert.equal(curve.color, '#c74440');
        assert.equal(curve.lineWidth, '6');
        assert.equal(curve.lineStyle, 'DASHED');
    });

    test('and compiles to exactly what writing its properties out would', () => {
        assert.deepEqual(
            compileAxis('style loud { color: RED; lineWidth: 6 }\ny = x @ use: loud').state,
            compileAxis('y = x @ color: RED, lineWidth: 6').state,
        );
    });

    test('one style may be used on many statements', async () => {
        const list = await loadClean(
            calculator(),
            'style swatch { pointSize: 14; showLabel }\n' +
                '(-2, 1) @ use: swatch, label: "one"\n' +
                '(2, 1) @ use: swatch, label: "two"',
        );

        for (const point of list) {
            assert.equal(point.pointSize, '14');
            assert.equal(point.showLabel, true);
        }
        assert.deepEqual(
            list.map(point => point.label),
            ['one', 'two'],
        );
    });

    test('a style that uses another carries both', async () => {
        const [curve] = await loadClean(
            calculator(),
            'style thick { lineWidth: 6 }\nstyle loud { use: thick; color: #c74440 }\ny = x @ use: loud',
        );

        assert.equal(curve.lineWidth, '6');
        assert.equal(curve.color, '#c74440');
    });

    test("a clause's own properties win over the style it uses", async () => {
        const [curve] = await loadClean(
            calculator(),
            'style loud { color: #c74440; lineWidth: 6 }\ny = x @ use: loud, color: #2d70b3',
        );

        assert.equal(curve.color, '#2d70b3');
        assert.equal(curve.lineWidth, '6');
    });

    test('wherever in the clause they are written', async () => {
        const [curve] = await loadClean(
            calculator(),
            'style loud { color: #c74440 }\ny = x @ color: #2d70b3, use: loud',
        );

        assert.equal(curve.color, '#2d70b3');
    });

    test("a style's own properties win over a style it uses", async () => {
        const [curve] = await loadClean(
            calculator(),
            'style base { color: #c74440; lineWidth: 6 }\n' +
                'style variant { use: base; color: #388c46 }\n' +
                'y = x @ use: variant',
        );

        assert.equal(curve.color, '#388c46');
        assert.equal(curve.lineWidth, '6');
    });

    test('of two styles, the later one used wins where they disagree', async () => {
        const [first, second] = await loadClean(
            calculator(),
            'style red { color: #c74440; lineStyle: DASHED }\n' +
                'style blue { color: #2d70b3; lineWidth: 6 }\n' +
                'y = x @ use: red, use: blue\n' +
                'y = 2x @ use: blue, use: red',
        );

        assert.equal(first.color, '#2d70b3');
        assert.equal(second.color, '#c74440');
        for (const curve of [first, second]) {
            assert.equal(curve.lineStyle, 'DASHED');
            assert.equal(curve.lineWidth, '6');
        }
    });

    test('a style carrying a slider makes a slider, and it plays', async () => {
        const [slider] = await loadClean(
            calculator(),
            'style knob { slider: 0..8 step 0.5; playing; loopMode: LOOP_FORWARD }\nt = 1 @ use: knob',
        );

        assert.equal(slider.slider?.min, '0');
        assert.equal(slider.slider?.max, '8');
        assert.equal(slider.slider?.step, '0.5');
        assert.equal(slider.slider?.isPlaying, true);
        assert.equal(slider.slider?.loopMode, 'LOOP_FORWARD');

        const first = (await calculator().evaluate('t')).numericValue;
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.notEqual((await calculator().evaluate('t')).numericValue, first);
    });

    test('a slider in a style is bounded by expressions the graph works out', async () => {
        await loadClean(
            calculator(),
            'lim = 3\nstyle ranged { slider: -lim..lim }\na = 99 @ use: ranged',
        );

        assert.equal((await calculator().evaluate('a')).numericValue, 3);
    });

    test('a style carrying an action run makes a clickable', async () => {
        await loadClean(
            calculator(),
            'a = 0\nb = 0\nstyle bumper { onClick: a -> a + 1, b -> b + 2; pointSize: 30 }\n' +
                '(1, 2) @ use: bumper',
        );
        assert.ok(await calculator().click({ x: 1, y: 2 }), 'the point was off screen');

        assert.equal((await calculator().evaluate('a')).numericValue, 1);
        assert.equal((await calculator().evaluate('b')).numericValue, 2);
    });

    test('a style may carry a colour Desmos works out', async () => {
        const [, curve] = await loadClean(
            calculator(),
            'hue = 30\nstyle warm { color: hsv(hue, 1, 1) }\ny = x @ use: warm',
        );

        assert.equal(curve.colorLatex, '\\operatorname{hsv}\\left(h_{ue},1,1\\right)');
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a style styles a table column, and a whole table', async () => {
        const [first, second] = (await loadClean(
            calculator(),
            'style dashed { color: #6042a6; lineStyle: DASHED; lines }\n' +
                'table { x = [1, 2]; y = [3, 4] @ use: dashed }\n' +
                'table { @ use: dashed; u = [1, 2]; v = [3, 4] }',
        )) as unknown as Table[];

        for (const styled of [first.columns[1], second.columns[1]]) {
            assert.equal(styled.color, '#6042a6');
            assert.equal(styled.lineStyle, 'DASHED');
            assert.equal(styled.lines, true);
        }
    });

    test('a style is in scope above the line that defines it', async () => {
        const [curve] = await loadClean(
            calculator(),
            'y = x @ use: later\nstyle later { lineWidth: 7 }',
        );

        assert.equal(curve.lineWidth, '7');
    });

    test('a style defined in an import is used in the file', async () => {
        const list = await loadClean(calculator(), 'import "styles"\ny = x @ use: shared', {
            path: '/graph.axis',
            resolveImport: () => ({
                path: '/styles.axis',
                source: 'style shared { color: #fa7e19; lineWidth: 4 }',
            }),
        });
        const curve = list.find(item => item.latex === 'y=x');

        assert.equal(curve?.color, '#fa7e19');
        assert.equal(curve?.lineWidth, '4');
    });

    test('a style is not in the graph', async () => {
        const list = await loadClean(calculator(), 'style loud { color: RED }\ny = x @ use: loud');

        assert.equal(list.length, 1);
    });

    test('a style setting what its place does not take is reported where it is used', async () => {
        // `showLabel` means nothing on a column; the rest of the style still
        // applies, and so does the rest of the table (spec §4.5).
        const { diagnostics } = await calculator().load(
            'style swatch { showLabel; color: #388c46 }\ntable { x = [1, 2]; y = [3, 4] @ use: swatch }',
        );
        const [table] = ((await calculator().getState()).expressions?.list ?? []) as Table[];

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['misplaced-property'],
        );
        assert.equal(table.columns[1].color, '#388c46');
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a style that does not exist is reported, and the statement still graphs', async () => {
        const { diagnostics } = await calculator().load('y = x @ use: nowhere, lineWidth: 5');
        const [curve] = ((await calculator().getState()).expressions?.list ?? []) as Expression[];

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['unknown-style'],
        );
        assert.equal(curve.lineWidth, '5');
    });

    test('a cycle of styles is reported, and the statement still graphs', async () => {
        const { diagnostics } = await calculator().load(
            'style a { use: b; lineWidth: 5 }\nstyle b { use: a }\ny = x @ use: a',
        );
        const [expression] = await calculator().inspectExpressions();

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['style-cycle'],
        );
        assert.equal(expression.analysis?.isGraphable, true);
    });
});
