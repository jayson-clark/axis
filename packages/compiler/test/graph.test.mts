// ═════════════════════════════════════════════════════════════════════════════
// A compilation as `{ state, options }`
// ═════════════════════════════════════════════════════════════════════════════
//
// `toGraph` is the one place a compilation is assembled into what a calculator
// takes, and every host applies its answer without adding to it - so anything
// it leaves out, no host puts back. Temporary with it: #20 makes `compileAxis`
// return this shape directly, and these become tests of that.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileAxis, toGraph } from '../dist/index.js';

describe('toGraph', () => {
    test('the expression list is the state the calculator is given', () => {
        const compiled = compileAxis('y = x\ny = 2x');
        const { state } = toGraph(compiled);

        assert.equal(state.version, 11);
        assert.deepEqual(state.expressions?.list, compiled.expressions);
    });

    test('a script with no viewport opens at the default framing', () => {
        const { state } = toGraph(compileAxis('y = x'));

        assert.deepEqual(state.graph?.viewport, { xmin: -10, ymin: -10, xmax: 10, ymax: 10 });
    });

    test('a viewport given in part is completed rather than dropped', () => {
        // Desmos ignores a half-written rectangle, so the edges the script left
        // out have to come from somewhere.
        const { state } = toGraph(compileAxis('config {\n    xmin: 0,\n    squareAxes: false\n}'));

        assert.deepEqual(state.graph?.viewport, { xmin: 0, ymin: -10, xmax: 10, ymax: 10 });
        assert.equal(state.graph?.squareAxes, false);
    });

    test('the ticker rides beside the list, and only when there is one', () => {
        assert.equal(toGraph(compileAxis('y = x')).state.expressions?.ticker, undefined);
        assert.ok(!('ticker' in toGraph(compileAxis('y = x')).state.expressions!));

        const ticking = toGraph(compileAxis('a = 0\nticker a -> a + 1'));
        assert.ok(ticking.state.expressions?.ticker);
    });

    test('the calculator options are what the config block compiled to', () => {
        const compiled = compileAxis('config {\n    degreeMode: true\n}');

        assert.deepEqual(toGraph(compiled).options, compiled.settings);
        assert.deepEqual(toGraph({ expressions: [] }).options, {});
    });

    test('a movable point keeps the style the script gave it', () => {
        const { state } = toGraph(compileAxis('y = x'));

        assert.equal(state.doNotMigrateMovablePointStyle, true);
    });
});
