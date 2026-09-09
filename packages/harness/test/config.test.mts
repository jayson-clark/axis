// ═════════════════════════════════════════════════════════════════════════════
// The config block, checked against the calculator it configures
// ═════════════════════════════════════════════════════════════════════════════
//
// Every property `config { … }` offers completions for is set here to something
// other than its default, and read back off the live calculator. A property the
// language advertises and Desmos does not take is a bug in the manifest; one
// that compiles to the wrong type is a bug in the compiler; and either way it
// is invisible until a real calculator is asked.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AXIS_CONFIG_PROPERTY_NAMES,
    AXIS_DEFAULT_CONFIG,
    AXIS_MANIFEST,
    AXIS_STATE_PROPERTY_NAMES,
} from '@axis-dsl/language';
import type { CalculatorOptions } from '@axis-dsl/desmos';
import { compileAxis } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';

/** A value each property is set to: never its default, so a no-op shows up. */
const VALUES: Record<string, string | number | boolean> = {
    // Non-boolean properties, written as the language documents them.
    backgroundColor: '#f0f0f0',
    textColor: '#101010',
    accentColor: '#00aa00',
    xAxisLabel: 'time',
    yAxisLabel: 'value',
    randomSeed: 'axis-test-seed',
    graphDescription: 'a parabola and a line',
    language: 'es',
    xAxisScale: 'logarithmic',
    yAxisScale: 'logarithmic',
    xAxisArrowMode: 'POSITIVE',
    yAxisArrowMode: 'BOTH',
    actions: true,
    reportPosition: 'coordinates',
    brailleMode: 'nemeth',
    fontSize: 20,
    xAxisStep: 2,
    yAxisStep: 5,
    xAxisMinorSubdivisions: 4,
    yAxisMinorSubdivisions: 3,
};

/**
 * Properties Desmos accepts without complaint but never puts back on
 * `calculator.settings`, so there is nothing to read to prove they took. They
 * are still checked as far as the compiler, which is the part Axis owns.
 */
const NOT_REFLECTED = new Set([
    'administerSecretFolders',
    'substitutions',
    'regressionTemplates',
    'intervalComprehensions',
    'recursion',
]);

/**
 * The keys Desmos keeps in the graph state rather than in the calculator's
 * options. `calculator.settings` has nothing to say about them, so they are
 * read off `getState().graph` instead, in `the viewport` below.
 *
 * They also cannot be tested one at a time the way everything else here is: the
 * four edges are one rectangle, and Desmos squares up whichever pair the script
 * left out. `squareAxes` is the switch that decides whether it does.
 */
const GRAPH_STATE = new Set(['xmin', 'xmax', 'ymin', 'ymax', 'squareAxes', 'userLockedViewport']);

/**
 * The keys Desmos reads off the *top* of the graph state, outside `graph`.
 * `calculator.settings` says nothing about them either, and neither does
 * `getState().graph` — they are checked in `randomization` below, which reads
 * them back off the state and then proves the graph actually behaves that way.
 */
const TOP_LEVEL_STATE = new Set<string>(AXIS_STATE_PROPERTY_NAMES);

/**
 * Options Desmos only reads when the calculator is constructed. `updateSettings`
 * takes them silently and changes nothing, so they are tested by building a
 * calculator around them instead.
 */
const CONSTRUCTION_ONLY = new Set(['keypadActivated']);

/** Each property's value, defaulting a boolean to the opposite of its default. */
function valueFor(name: string): string | number | boolean {
    const documented = VALUES[name];
    if (documented !== undefined) {
        return documented;
    }
    const property = AXIS_MANIFEST.configProperties.find(entry => entry.name === name);
    assert.equal(property?.valueType, 'boolean', `${name} needs a test value`);
    return !/default: true/.test(property?.detail ?? '');
}

/** A config block setting one property, as a graph would write it. */
function configBlock(name: string): string {
    return `config {\n    ${name}: ${valueFor(name)}\n}\ny = x`;
}

describe('the config block', { skip }, () => {
    const calculator = useCalculator();

    const reflected = AXIS_CONFIG_PROPERTY_NAMES.filter(
        name =>
            !NOT_REFLECTED.has(name) &&
            !CONSTRUCTION_ONLY.has(name) &&
            !GRAPH_STATE.has(name) &&
            !TOP_LEVEL_STATE.has(name),
    );

    test('every property in the manifest is accounted for', () => {
        const known = new Set([
            ...reflected,
            ...NOT_REFLECTED,
            ...CONSTRUCTION_ONLY,
            ...GRAPH_STATE,
            ...TOP_LEVEL_STATE,
        ]);
        const missing = AXIS_CONFIG_PROPERTY_NAMES.filter(name => !known.has(name));

        assert.deepEqual(missing, []);
    });

    // One graph per property rather than one carrying all of them: several
    // options gate others, and a batch would only prove they interact.
    for (const name of reflected) {
        test(`${name} reaches the calculator`, async () => {
            await calculator().load(configBlock(name));
            const applied = await calculator().getSettings();

            assert.equal(applied[name as keyof CalculatorOptions], valueFor(name));
        });
    }

    for (const name of NOT_REFLECTED) {
        test(`${name} compiles, though Desmos does not report it back`, () => {
            const source = `config {\n    ${name}: ${valueFor(name)}\n}\ny = x`;
            const settings = compileAxis(source).settings ?? {};

            assert.equal(settings[name as keyof CalculatorOptions], valueFor(name));
        });
    }

    test('none of them logged anything to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });

    test('an option that gates another is honoured over it', async () => {
        // logScales is what makes a logarithmic axis available, so a config
        // that turns it off and asks for one anyway gets a linear axis. Worth
        // pinning: it is the reason these are checked one at a time.
        await calculator().load(
            'config {\n    logScales: false,\n    xAxisScale: logarithmic\n}\ny = x',
        );
        const applied = await calculator().getSettings();

        assert.equal(applied.logScales, false);
        assert.equal(applied.xAxisScale, 'linear');
    });
});

describe('randomization', { skip }, () => {
    const calculator = useCalculator();

    /**
     * A graph whose only content is one function that shuffles, called twice.
     * Under the legacy behaviour both calls draw the same list; under the new
     * one the argument is part of the seed and they diverge. The seed is fixed
     * so that a failure is a real difference rather than a fresh roll.
     */
    const SOURCE = (flag: string) =>
        'config {\n' +
        '    randomSeed: "axis-random-seed",\n' +
        `    includeFunctionParametersInRandomSeed: ${flag}\n` +
        '}\n' +
        'h(k) = [1...10].shuffle\n' +
        'A = h(1)\n' +
        'B = h(2)';

    test('it is neither a calculator option nor part of graph', () => {
        // The reason it is a bucket of its own: Desmos takes it through
        // updateSettings, as a construction option, and inside `graph`, and
        // ignores it in all three.
        const compiled = compileAxis('y = x');

        assert.deepEqual(compiled.settings, AXIS_DEFAULT_CONFIG);
        assert.equal(compiled.graph, undefined);
        assert.deepEqual(compiled.state, { includeFunctionParametersInRandomSeed: true });
    });

    test('it reaches the top of the graph state', async () => {
        await calculator().load(SOURCE('true'));
        const state = await calculator().getState();

        assert.equal(state.includeFunctionParametersInRandomSeed, true);
        // Beside `graph` rather than in it, which is the distinction the whole
        // third bucket exists for.
        assert.equal(state.graph?.includeFunctionParametersInRandomSeed, undefined);
    });

    test('off, it is written by being left out', async () => {
        // Desmos serializes the flag only when it is on: a saved state without
        // it *is* a state with it off. Worth pinning, because it means the
        // decompiler cannot tell "legacy" from "unset" — there is no
        // difference — and so has to write the `false` back explicitly.
        await calculator().load(SOURCE('false'));
        const state = await calculator().getState();

        assert.equal(state.includeFunctionParametersInRandomSeed, undefined);
    });

    test("on, a function's arguments change what it draws", async () => {
        await calculator().load(SOURCE('true'));

        const a = await calculator().evaluate('A');
        const b = await calculator().evaluate('B');

        assert.equal(a.listValue.length, 10);
        assert.notDeepEqual(a.listValue, b.listValue);
    });

    test('off, every call to the same function draws alike', async () => {
        await calculator().load(SOURCE('false'));

        const a = await calculator().evaluate('A');
        const b = await calculator().evaluate('B');

        assert.equal(a.listValue.length, 10);
        assert.deepEqual(a.listValue, b.listValue);
    });

    test('a script that says nothing gets the modern behaviour', async () => {
        // The default, and the whole point of having one: a graph written today
        // should not silently inherit a migration flag from 2024.
        await calculator().load(
            'config {\n    randomSeed: "axis-random-seed"\n}\n' +
                'h(k) = [1...10].shuffle\nA = h(1)\nB = h(2)',
        );

        const a = await calculator().evaluate('A');
        const b = await calculator().evaluate('B');

        assert.notDeepEqual(a.listValue, b.listValue);
    });

    test('nothing logged to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});

describe('the viewport', { skip }, () => {
    const calculator = useCalculator();

    test('the four edges reach the graph state', async () => {
        // squareAxes off, because Desmos honours the rectangle as written only
        // when it is not also keeping the units square: with it on, a viewport
        // that is not already square comes back stretched on one axis.
        await calculator().load(
            'config {\n' +
                '    xmin: 0,\n' +
                '    xmax: 1,\n' +
                '    ymin: 0,\n' +
                '    ymax: 1,\n' +
                '    squareAxes: false\n' +
                '}\n' +
                'y = x',
        );
        const state = await calculator().getState();

        assert.deepEqual(state.graph?.viewport, { xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
        assert.equal(state.graph?.squareAxes, false);
    });

    test('they are not calculator options', async () => {
        // The reason they are separated from `settings` at all: handing these
        // to updateSettings is not an error, it is silence.
        const compiled = compileAxis('config {\n    xmin: 0,\n    squareAxes: false\n}\ny = x');

        assert.deepEqual(compiled.settings, AXIS_DEFAULT_CONFIG);
        assert.deepEqual(compiled.graph, { squareAxes: false, viewport: { xmin: 0 } });
    });

    test('nothing logged to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});

describe('config options set at construction', { skip }, () => {
    const calculator = useCalculator({
        settings: Object.fromEntries(
            [...CONSTRUCTION_ONLY].map(name => [name, valueFor(name)]),
        ) as CalculatorOptions,
    });

    for (const name of CONSTRUCTION_ONLY) {
        test(`${name} takes when the calculator is built with it`, async () => {
            const settings = await calculator().getSettings();

            assert.equal(settings[name as keyof CalculatorOptions], valueFor(name));
        });
    }
});

describe('config options Desmos acts on', { skip }, () => {
    const calculator = useCalculator();

    test('degreeMode changes what the trig functions mean', async () => {
        await calculator().load('a = sin(90)');
        const inRadians = (await calculator().evaluate('a')).numericValue;
        assert.ok(Math.abs(inRadians - Math.sin(90)) < 1e-9, `got ${inRadians}`);

        await calculator().load('config {\n    degreeMode: true\n}\na = sin(90)');

        assert.equal((await calculator().evaluate('a')).numericValue, 1);
    });

    test('randomSeed is the seed the calculator actually holds', async () => {
        await calculator().load('config {\n    randomSeed: axis-fixed-seed\n}\ny = x');

        assert.equal((await calculator().getSettings()).randomSeed, 'axis-fixed-seed');
        assert.equal((await calculator().getState()).randomSeed, 'axis-fixed-seed');
    });

    test('several options in one block all take', async () => {
        await calculator().load(
            'config {\n    degreeMode: true,\n    xAxisStep: 2,\n    xAxisLabel: time\n}\ny = x',
        );
        const settings = await calculator().getSettings();

        assert.equal(settings.degreeMode, true);
        assert.equal(settings.xAxisStep, 2);
        assert.equal(settings.xAxisLabel, 'time');
    });

    test('polarMode switches the grid over', async () => {
        await calculator().load('config {\n    polarMode: true\n}\nr = theta');
        const settings = await calculator().getSettings();

        assert.equal(settings.polarMode, true);
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('allowComplex changes what the square root of a negative is', async () => {
        await calculator().load('a = sqrt(-1)');
        const real = (await calculator().inspectExpressions())[0].analysis;
        assert.ok(real?.isError || Number.isNaN((real?.evaluation as { value: number })?.value));

        await calculator().load('config {\n    allowComplex: true\n}\na = sqrt(-1)');

        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('an imported config merges under the entry script’s', () => {
        const { settings } = compileAxis('import "lib"\nconfig {\n    showGrid: true\n}', {
            path: '/graph.axis',
            resolveImport: () => ({
                path: '/lib.axis',
                source: 'config {\n    showGrid: false,\n    degreeMode: true\n}',
            }),
        });

        assert.equal(settings?.showGrid, true, 'the entry script has to win');
        assert.equal(settings?.degreeMode, true, 'and the import still contributes');
    });
});
