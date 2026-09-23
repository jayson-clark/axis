// ═════════════════════════════════════════════════════════════════════════════
// The ticker, checked against a graph that really has one
// ═════════════════════════════════════════════════════════════════════════════
//
// A ticker is the one thing a script can say that leaves no trace in the
// expression list, so nothing about it can be checked by looking at what the
// compiler emitted. It either runs or it does not, and only a calculator knows
// which - as the `actions` case below is there to remember.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_DEFAULT_CONFIG, propertiesFor } from '@axis-dsl/syntax';
import { compileAxis, type CompileOptions } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';

/** One statement per property, and what the applied graph must then hold. */
const PROPERTIES: Record<string, { source: string; expected: Record<string, unknown> }> = {
    minStep: {
        source: 'a = 0\nticker a -> a + 1 @ minStep: 200',
        expected: { handlerLatex: 'a\\to a+1', minStepLatex: '200' },
    },
    playing: {
        source: 'a = 0\nticker a -> a + 1 @ minStep: 5000, playing',
        expected: { handlerLatex: 'a\\to a+1', minStepLatex: '5000', playing: true },
    },
    open: {
        source: 'a = 0\nticker a -> a + 1 @ open',
        expected: { handlerLatex: 'a\\to a+1', open: true },
    },
};

/**
 * Let a playing ticker run a while before asking what it did. A plain wait
 * rather than `settle`, which a ticking graph never satisfies.
 */
const run = () => new Promise(resolve => setTimeout(resolve, 400));

describe('the ticker', { skip }, () => {
    const calculator = useCalculator();

    test('every ticker property the language offers is covered here', () => {
        const missing = propertiesFor('ticker')
            .map(property => property.name)
            .filter(name => !PROPERTIES[name]);

        assert.deepEqual(missing, [], 'ticker properties with no test');
    });

    for (const [property, { source, expected }] of Object.entries(PROPERTIES)) {
        test(`${property} reaches the calculator`, async () => {
            const { diagnostics } = await calculator().load(source);
            const state = await calculator().getState();

            assert.deepEqual(diagnostics, []);
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
        await calculator().load('a = 0\nticker a -> a + 1 @ minStep: 20, playing');
        await run();

        assert.ok(
            (await calculator().evaluate('a')).numericValue > 0,
            'the ticker was applied but never ticked',
        );
    });

    test('a ticker that is not playing does not tick', async () => {
        await calculator().load('a = 0\nticker a -> a + 1 @ minStep: 20');
        await run();

        assert.equal((await calculator().evaluate('a')).numericValue, 0);
    });

    test('its handler may be a run, without brackets, and every action in it runs', async () => {
        const { diagnostics } = await calculator().load(
            'a = 0\nb = 0\nticker a -> a + 1, b -> b - 1 @ minStep: 20, playing',
        );
        await run();

        assert.deepEqual(diagnostics, []);
        // Asked in one expression, since the ticker is still running: two
        // evaluations would read two different ticks.
        assert.ok((await calculator().evaluate('a')).numericValue > 0, 'the run never ran');
        assert.equal(
            (await calculator().evaluate('a + b')).numericValue,
            0,
            'the second action did not run with the first',
        );
    });

    test('its handler may be a run the script named', async () => {
        const { diagnostics } = await calculator().load(
            'a = 0\nb = 0\nadvance = a -> a + 1, b -> b + 2\nticker advance @ minStep: 20, playing',
        );
        await run();

        assert.deepEqual(diagnostics, []);

        assert.ok((await calculator().evaluate('a')).numericValue > 0, 'the named run never ran');
        assert.equal((await calculator().evaluate('b - 2a')).numericValue, 0);
    });

    test('dt is the time since the last tick', async () => {
        // A counter adding up dt keeps real time, whatever the tick rate.
        // It starts ticking as the graph is applied, so the clock starts
        // before the load does.
        const started = Date.now();
        await calculator().load('t = 0\nticker t -> t + dt @ minStep: 20, playing');
        await run();
        const elapsed = Date.now() - started;
        const counted = (await calculator().evaluate('t')).numericValue;

        assert.ok(counted > 0 && counted <= elapsed + 100, `counted ${counted} of ${elapsed}ms`);
    });

    test('minStep may be an expression the graph works out', async () => {
        const { diagnostics } = await calculator().load(
            'gap = 20\na = 0\nticker a -> a + 1 @ minStep: gap * 2, playing',
        );
        await run();
        const ticker = (await calculator().getState()).expressions?.ticker;

        assert.deepEqual(diagnostics, []);
        assert.equal(ticker?.minStepLatex, 'g_{ap}\\cdot2');
        assert.ok((await calculator().evaluate('a')).numericValue > 0);
    });

    test('a ticker switches actions on, which `auto` would not have done', async () => {
        // `actions: auto` means "on if the graph uses actions", and Desmos
        // decides that from the expression list - which the ticker is not in.
        // So a graph whose only action is its ticker is left with actions off
        // and silently never ticks; the compiler turns them on for that reason.
        assert.deepEqual(compileAxis('a = 0\nticker a -> a + 1').options, {
            ...AXIS_DEFAULT_CONFIG,
            actions: true,
        });

        await calculator().load('a = 0\nticker a -> a + 1 @ minStep: 20, playing');
        assert.equal((await calculator().getSettings()).actions, true);
    });

    test('a script that switches actions off keeps them off', async () => {
        const source = 'config { actions: false }\na = 0\nticker a -> a + 1 @ playing';

        assert.deepEqual(compileAxis(source).options, {
            ...AXIS_DEFAULT_CONFIG,
            actions: false,
        });

        await calculator().load(source);
        assert.equal((await calculator().getSettings()).actions, false);
    });

    test('a ticker inside a folder is an error, and is not applied', async () => {
        const { diagnostics } = await calculator().load(
            'a = 0\nfolder "F" {\n    ticker a -> a + 1 @ playing\n}',
        );

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['misplaced-ticker'],
        );
        assert.equal((await calculator().getState()).expressions?.ticker, undefined);
    });

    test('a second ticker is an error, and the first stands', async () => {
        const { diagnostics } = await calculator().load('a = 0\nticker a -> 1\nticker a -> 2');

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['duplicate-ticker'],
        );
        assert.equal((await calculator().getState()).expressions?.ticker?.handlerLatex, 'a\\to1');
    });

    test('an imported ticker runs, unless the script has one of its own', async () => {
        const options: CompileOptions = {
            path: '/graph.axis',
            resolveImport: () => ({
                path: '/clock.axis',
                source: 'n = 0\nticker n -> n + 1 @ minStep: 20, playing',
            }),
        };

        await calculator().load('import "clock"', options);
        await run();
        assert.ok((await calculator().evaluate('n')).numericValue > 0, 'the import never ticked');

        await calculator().load(
            'import "clock"\nm = 0\nticker m -> m + 1 @ minStep: 20, playing',
            options,
        );
        await run();
        assert.equal((await calculator().evaluate('n')).numericValue, 0);
        assert.ok((await calculator().evaluate('m')).numericValue > 0);
    });

    test('nothing logged to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});
