// ═════════════════════════════════════════════════════════════════════════════
// Styles - metadata with a name, resolved away before the graph sees it
// ═════════════════════════════════════════════════════════════════════════════
//
// Spec §4.5: styles apply in the order written, a style may use others, and a
// property the clause writes itself beats every style it uses, wherever the
// `use:` stands in the clause.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Expression, Table } from '@axis-dsl/desmos';
import { compileAxis, listOf, only } from './support/compile.mts';

describe('using a style', () => {
    test('applies its properties as though written in place', () => {
        const point = only<Expression>(
            'style swatch { pointSize: 14; showLabel }\n(1, 2) @ use: swatch',
        );
        assert.equal(point.pointSize, '14');
        assert.equal(point.movablePointSize, '14');
        assert.equal(point.showLabel, true);
    });

    test('lets the clause’s own properties win, wherever the use is written', () => {
        const [before, after] = listOf(
            'style hot { color: RED; lineWidth: 5 }\ny = x @ use: hot, color: GREEN\ny = x @ color: GREEN, use: hot',
        ) as Expression[];

        assert.equal(before.color, '#388c46');
        assert.equal(after.color, '#388c46');
        assert.equal(after.lineWidth, '5');
    });

    test('applies several in the order written, the later winning', () => {
        const [coldWins, hotWins] = listOf(
            'style hot { color: RED }\nstyle cold { color: BLUE }\ny = x @ use: hot, use: cold\ny = x @ use: cold, use: hot',
        ) as Expression[];

        assert.equal(coldWins.color, '#2d70b3');
        assert.equal(hotWins.color, '#c74440');
    });

    test('composes styles, a style’s own properties beating those it uses', () => {
        const point = only<Expression>(
            'style marker { pointSize: 16; color: BLACK }\nstyle hot { use: marker; color: RED }\n(1, 2) @ use: hot',
        );
        assert.equal(point.pointSize, '16');
        assert.equal(point.color, '#c74440');
    });

    test('carries any property a statement may have, a slider included', () => {
        const knob = only<Expression>('style knob { slider: -3..3 step 0.1 }\na = 1 @ use: knob');
        assert.deepEqual(knob.slider, {
            min: '-3',
            max: '3',
            hardMin: true,
            hardMax: true,
            step: '0.1',
        });
    });

    test('is used the same way from an @{ } block', () => {
        const line = only<Expression>(
            'style guide { color: BLACK; lineStyle: DASHED }\ny = x @{\n    use: guide\n    lineStyle: SOLID\n}',
        );
        assert.equal(line.color, '#000000');
        assert.equal(line.lineStyle, 'SOLID');
    });

    test('styles a table column, and a whole table', () => {
        const table = only<Table>(
            'style red { color: RED }\nstyle wide { lineWidth: 4 }\ntable { @ use: wide\n    x = [1]\n    y = [2] @ use: red\n}',
        );
        assert.equal(table.columns[1].color, '#c74440');
        assert.equal(table.columns[1].lineWidth, '4');
        assert.equal(table.columns[0].lineWidth, '4');
    });

    test('is in scope above its definition', () => {
        assert.equal(only<Expression>('y = x @ use: s\nstyle s { color: RED }').color, '#c74440');
    });

    test('never reaches the graph itself', () => {
        const { state } = compileAxis('style s { color: RED }');
        assert.deepEqual(state.expressions?.list, []);
    });

    test('survives a loop, which is reported', () => {
        const result = compileAxis(
            'style a { use: b; color: RED }\nstyle b { use: a }\ny = x @ use: a',
        );
        assert.deepEqual(
            result.diagnostics.map(d => d.code),
            ['style-cycle'],
        );
        assert.equal((result.state.expressions?.list?.[0] as Expression).color, '#c74440');
    });
});
