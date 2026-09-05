// ═════════════════════════════════════════════════════════════════════════════
// The ticker, checked against a graph that really has one
// ═════════════════════════════════════════════════════════════════════════════
//
// A ticker is the one thing a script can say that leaves no trace in the
// expression list, so nothing about it can be checked by looking at what the
// compiler emitted. It either runs or it does not, and only a calculator knows
// which — as the `actions` case below is there to remember.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_TICKER_PROPERTY_NAMES } from '@axis-dsl/language';
import { compileAxis } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';

/** One statement per property, and what the applied graph must then hold. */
const PROPERTIES: Record<string, { source: string; expected: Record<string, unknown> }> = {
    minStep: {
        source: 'a = 0\nticker a -> a + 1 # minStep: 200',
        expected: { handlerLatex: 'a\\to a+1', minStepLatex: '200' },
    },
    playing: {
        source: 'a = 0\nticker a -> a + 1 # minStep: 5000, playing: true',
        expected: { handlerLatex: 'a\\to a+1', minStepLatex: '5000', playing: true },
    },
    open: {
        source: 'a = 0\nticker a -> a + 1 # open: true',
        expected: { handlerLatex: 'a\\to a+1', open: true },
    },
};

describe('the ticker', { skip }, () => {
    const calculator = useCalculator();

    test('every ticker property the language offers is covered here', () => {
        const covered = new Set(Object.keys(PROPERTIES));
        const missing = AXIS_TICKER_PROPERTY_NAMES.filter(name => !covered.has(name));

        assert.deepEqual(missing, [], 'ticker properties with no test');
    });

    for (const [property, { source, expected }] of Object.entries(PROPERTIES)) {
        test(`${property} reaches the calculator`, async () => {
            await calculator().load(source);
            const state = await calculator().getState();

            assert.deepEqual(state.expressions?.ticker, expected);
        });
    }

    test('a graph with no ticker carries none at all', async () => {
        await calculator().load('a = 0\n(a, 0)');

        assert.equal((await calculator().getState()).expressions?.ticker, undefined);
    });

    test('a playing ticker actually advances the graph', async () => {
        // The whole point, and the thing the state alone cannot say: a ticker
        // Desmos has accepted and is not running looks exactly like one it is.
        await calculator().load('a = 0\nticker a -> a + 1 # minStep: 20, playing: true');
        await calculator().settle(400);

        assert.ok(
            (await calculator().evaluate('a')).numericValue > 0,
            'the ticker was applied but never ticked',
        );
    });

    test('a ticker switches actions on, which `auto` would not have done', async () => {
        // `actions: auto` means "on if the graph uses actions", and Desmos
        // decides that from the expression list — which the ticker is not in.
        // So a graph whose only action is its ticker is left with actions off
        // and silently never ticks; the compiler turns them on for that reason.
        assert.deepEqual(compileAxis('a = 0\nticker a -> a + 1').settings, { actions: true });

        await calculator().load('a = 0\nticker a -> a + 1 # minStep: 20, playing: true');
        assert.equal((await calculator().getSettings()).actions, true);
    });

    test('a script that switches actions off keeps them off', async () => {
        const source = 'config {\n    actions: false\n}\na = 0\nticker a -> a + 1 # playing: true';

        assert.deepEqual(compileAxis(source).settings, { actions: false });

        await calculator().load(source);
        assert.equal((await calculator().getSettings()).actions, false);
    });

    test('nothing logged to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});
