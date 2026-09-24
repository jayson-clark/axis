// ═════════════════════════════════════════════════════════════════════════════
// Metadata, checked against a graph that really has it
// ═════════════════════════════════════════════════════════════════════════════
//
// `@ color: RED` is only worth writing if Desmos ends up holding it. The
// compiler's own tests already assert what it emits; these assert what survives
// being applied - which is a different question, and the one that caught
// `sliderBounds` being dropped on the floor by `setState`.
//
// A property is legal in more than one place (spec §4.6), and each place is
// lowered by different code: `lineWidth` on an expression, on a table column,
// as a table's default for its columns and from a style are four routes to the
// graph, and any one of them can lose it. So the cases are kept per placement,
// and the guard below walks the manifest's `appliesTo` rather than its names.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AXIS_PALETTE,
    AXIS_PROPERTY_PLACEMENTS,
    findProperty,
    propertiesFor,
    type PropertyPlacement,
} from '@axis-dsl/syntax';
import type { DesmosExpression, Expression, Folder, GraphImage, Table } from '@axis-dsl/desmos';
import { compileAxis, type CompileOptions } from '@axis-dsl/compiler';
import type { AxisCalculator } from '../dist/index.js';
import { skip, useCalculator } from './support.mts';

/**
 * One use of a property, and what the applied graph must then hold - so a
 * property Desmos silently drops fails here.
 *
 * The properties are a list rather than a clause, because the same list is
 * written two ways: trailing its statement (`@ a, b`) and as the body of a
 * style (`style s { a; b }`) the statement then uses.
 */
interface PropertyCase {
    /** Lines the statement needs above it: the variables it reads, a style. */
    setup?: string;
    /** The statement the properties trail, where the placement has one. */
    statement?: string;
    properties: string[];
    expected: Record<string, unknown>;
    /**
     * Set for a property Desmos writes into a state and then refuses to read
     * back out of one. `expected` is what the applied graph holds instead, so
     * the surprise is pinned rather than skipped.
     */
    dropped?: true;
}

/** A 1x1 transparent GIF, quoted as the `image` statement takes it. */
const IMAGE = '"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"';

/** The file every `import` below reads, whatever it names. */
const IMPORT_OPTIONS: CompileOptions = {
    path: '/graph.axis',
    resolveImport: () => ({ path: '/lib.axis', source: 'y = 2x' }),
};

/** A style for the `use` cases to use: one property Desmos keeps as written. */
const THICK = 'style thick { lineWidth: 5 }';

/** The slider bounds Desmos keeps, since it leaves a bound matching its default off. */
const SLIDER = { min: '1', max: '9', hardMin: true, hardMax: true };

/** Every property an expression takes. */
const EXPRESSION: Record<string, PropertyCase> = {
    use: {
        setup: THICK,
        statement: 'y = x',
        properties: ['use: thick'],
        expected: { lineWidth: '5' },
    },
    color: { statement: 'y = x', properties: ['color: #ff0000'], expected: { color: '#ff0000' } },
    suppressTextOutline: {
        statement: '(1, 2)',
        properties: ['label: "P"', 'showLabel', 'suppressTextOutline'],
        expected: { suppressTextOutline: true },
    },
    lineStyle: {
        statement: 'y = x',
        properties: ['lineStyle: DASHED'],
        expected: { lineStyle: 'DASHED' },
    },
    lineWidth: { statement: 'y = x', properties: ['lineWidth: 5'], expected: { lineWidth: '5' } },
    lineOpacity: {
        statement: 'y = x',
        properties: ['lineOpacity: 0.3'],
        expected: { lineOpacity: '0.3' },
    },
    pointStyle: {
        statement: '(1, 2)',
        properties: ['pointStyle: OPEN'],
        expected: { pointStyle: 'OPEN' },
    },
    pointSize: {
        statement: '(1, 2)',
        properties: ['pointSize: 20'],
        expected: { pointSize: '20' },
    },
    // Only a *draggable* point keeps this. Desmos drops it from a point whose
    // coordinates are literals, since such a point can never be moved - which
    // is why the case defines the coordinates as free variables first.
    movablePointSize: {
        setup: 'a = 1\nb = 2',
        statement: '(a, b)',
        properties: ['movablePointSize: 20'],
        expected: { movablePointSize: '20' },
    },
    pointOpacity: {
        statement: '(1, 2)',
        properties: ['pointOpacity: 0.4'],
        expected: { pointOpacity: '0.4' },
    },
    fillOpacity: {
        statement: 'y < x',
        properties: ['fillOpacity: 0.7'],
        expected: { fillOpacity: '0.7' },
    },
    hidden: { statement: 'y = x', properties: ['hidden'], expected: { hidden: true } },
    secret: { statement: 'y = x', properties: ['secret'], expected: { secret: true } },
    points: { statement: '(1, 2)', properties: ['points: false'], expected: { points: false } },
    lines: { statement: 'y = x', properties: ['lines: false'], expected: { lines: false } },
    fill: { statement: 'y < x', properties: ['fill: false'], expected: { fill: false } },
    label: { statement: '(1, 2)', properties: ['label: "P"'], expected: { label: 'P' } },
    showLabel: {
        statement: '(1, 2)',
        properties: ['label: "P"', 'showLabel'],
        expected: { label: 'P', showLabel: true },
    },
    labelSize: {
        statement: '(1, 2)',
        properties: ['label: "P"', 'labelSize: 2'],
        expected: { labelSize: '2' },
    },
    labelOrientation: {
        statement: '(1, 2)',
        properties: ['label: "P"', 'labelOrientation: above'],
        expected: { labelOrientation: 'above' },
    },
    labelAngle: {
        statement: '(1, 2)',
        properties: ['label: "P"', 'showLabel', 'labelAngle: pi / 4'],
        expected: { labelAngle: '\\frac{\\pi}{4}' },
    },
    interactiveLabel: {
        statement: '(1, 2)',
        properties: ['label: "P"', 'showLabel', 'interactiveLabel'],
        expected: { interactiveLabel: true },
    },
    editableLabelMode: {
        statement: '(1, 2)',
        properties: ['label: "P"', 'showLabel', 'editableLabelMode: TEXT'],
        expected: { editableLabelMode: 'TEXT' },
    },
    residuals: {
        setup: 'xs = [1, 2, 3, 4]\nys = [2.1, 3.9, 6.2, 7.8]',
        statement: 'ys ~ m xs + b',
        properties: ['residuals: r1'],
        expected: { residualVariable: 'r_{1}' },
    },
    logMode: {
        setup: 'xs = [1, 2, 3, 4]\nys = [2, 4.1, 7.9, 16.2]',
        statement: 'ys ~ a b ^ xs',
        properties: ['logMode'],
        expected: { isLogModeRegression: true },
    },
    binAlignment: {
        setup: 'L = [1, 5, 5, 6, 8, 9, 9, 9, 30]',
        statement: 'histogram(L, 2)',
        properties: ['binAlignment: left'],
        expected: { vizProps: { binAlignment: 'left' } },
    },
    histogramMode: {
        setup: 'L = [1, 5, 5, 6, 8, 9, 9, 9, 30]',
        statement: 'histogram(L, 2)',
        properties: ['histogramMode: density'],
        expected: { vizProps: { histogramMode: 'density' } },
    },
    dotplotXMode: {
        setup: 'L = [1, 5, 5, 6, 8, 9, 9, 9, 30]',
        statement: 'dotplot(L, 2)',
        properties: ['dotplotXMode: bin'],
        expected: { vizProps: { dotplotXMode: 'bin' } },
    },
    alignedAxis: {
        setup: 'L = [1, 5, 5, 6, 8, 9, 9, 9, 30]',
        statement: 'boxplot(L)',
        properties: ['alignedAxis: y'],
        expected: { vizProps: { alignedAxis: 'y' } },
    },
    axisOffset: {
        setup: 'L = [1, 5, 5, 6, 8, 9, 9, 9, 30]',
        statement: 'boxplot(L)',
        properties: ['axisOffset: 2'],
        expected: { vizProps: { axisOffset: '2' } },
    },
    breadth: {
        setup: 'L = [1, 5, 5, 6, 8, 9, 9, 9, 30]',
        statement: 'boxplot(L)',
        properties: ['breadth: 0.5'],
        expected: { vizProps: { breadth: '0.5' } },
    },
    showBoxplotOutliers: {
        setup: 'L = [1, 5, 5, 6, 8, 9, 9, 9, 30]',
        statement: 'boxplot(L)',
        properties: ['showBoxplotOutliers: false'],
        expected: { vizProps: { showBoxplotOutliers: false } },
    },
    displayEvaluationAsFraction: {
        statement: 'a = 1 / 3',
        properties: ['displayEvaluationAsFraction'],
        expected: { displayEvaluationAsFraction: true },
    },
    pointOutline: {
        statement: '(1, 2)',
        properties: ['pointOutline'],
        expected: { pointOutline: true },
    },
    dragMode: { statement: '(1, 2)', properties: ['dragMode: XY'], expected: { dragMode: 'XY' } },
    onClick: {
        setup: 'a = 0',
        statement: '(1, 2)',
        properties: ['onClick: a -> a + 1'],
        expected: { clickableInfo: { enabled: true, latex: 'a\\to a+1' } },
    },
    clickable: {
        // Desmos writes a switched-off clickable by leaving `enabled` out
        // rather than storing false, so that is what comes back.
        setup: 'a = 0',
        statement: '(1, 2)',
        properties: ['onClick: a -> a + 1', 'clickable: false'],
        expected: { clickableInfo: { latex: 'a\\to a+1' } },
    },
    description: {
        setup: 'a = 0',
        statement: '(1, 2)',
        properties: ['onClick: a -> a + 1', 'description: "bump a"'],
        expected: {
            description: 'bump a',
            clickableInfo: { enabled: true, latex: 'a\\to a+1' },
        },
    },
    slider: {
        // Desmos leaves a bound off the state when it matches its own default,
        // so the bounds here are ones it has an opinion about.
        statement: 'a = 5',
        properties: ['slider: 1..9 step 0.5'],
        expected: { slider: { ...SLIDER, step: '0.5' } },
    },
    playing: {
        statement: 'a = 5',
        properties: ['slider: 1..9', 'playing'],
        expected: { slider: { ...SLIDER, isPlaying: true } },
    },
    loopMode: {
        statement: 'a = 5',
        properties: ['slider: 1..9', 'playing', 'loopMode: LOOP_FORWARD'],
        expected: { slider: { ...SLIDER, isPlaying: true, loopMode: 'LOOP_FORWARD' } },
    },
    playDirection: {
        statement: 'a = 5',
        properties: ['slider: 1..9', 'playDirection: -1'],
        expected: { slider: { ...SLIDER, playDirection: -1 } },
    },
    // Desmos writes this into a graph it saves and drops it from one it is
    // given, playing or not - so a file can carry the speed a graph was
    // saved with, and no more. The compiler still emits it, which is what
    // keeps a decompiled graph the graph it was read from.
    animationPeriod: {
        statement: 'a = 5',
        properties: ['slider: 1..9', 'playing', 'animationPeriod: 4000'],
        expected: { slider: { ...SLIDER, isPlaying: true } },
        dropped: true,
    },
    // Desmos keeps the same bounds twice, so one property in the file sets
    // both keys; `parametricDomain` is the second of them written on its own.
    domain: {
        statement: '(cos(t), sin(t))',
        properties: ['domain: 0..2pi'],
        expected: {
            domain: { min: '0', max: '2\\pi' },
            parametricDomain: { min: '0', max: '2\\pi' },
        },
    },
    parametricDomain: {
        statement: '(cos(t), sin(t))',
        properties: ['domain: 0..2pi', 'parametricDomain: 0.5..2pi'],
        expected: { parametricDomain: { min: '0.5', max: '2\\pi' } },
    },
    polarDomain: {
        setup: 'config { polarMode: true }',
        statement: 'r = theta',
        properties: ['polarDomain: 0..2pi'],
        expected: { polarDomain: { min: '0', max: '2\\pi' } },
    },
};

/**
 * Every property a table column takes. A column is not an expression to
 * Desmos, and it keeps less: see `movablePointSize`.
 */
const COLUMN: Record<string, PropertyCase> = {
    use: { setup: THICK, properties: ['use: thick'], expected: { lineWidth: '5' } },
    color: { properties: ['color: #ff0000'], expected: { color: '#ff0000' } },
    lineStyle: { properties: ['lineStyle: DASHED'], expected: { lineStyle: 'DASHED' } },
    lineWidth: { properties: ['lineWidth: 5'], expected: { lineWidth: '5' } },
    lineOpacity: { properties: ['lineOpacity: 0.3'], expected: { lineOpacity: '0.3' } },
    pointStyle: { properties: ['pointStyle: OPEN'], expected: { pointStyle: 'OPEN' } },
    pointSize: { properties: ['pointSize: 20'], expected: { pointSize: '20' } },
    // Dropped from a column however it is dragged: a table point's size is
    // `pointSize`, movable or not.
    movablePointSize: {
        properties: ['movablePointSize: 25', 'dragMode: XY'],
        expected: { movablePointSize: undefined, dragMode: 'XY' },
        dropped: true,
    },
    pointOpacity: { properties: ['pointOpacity: 0.4'], expected: { pointOpacity: '0.4' } },
    hidden: { properties: ['hidden'], expected: { hidden: true } },
    points: { properties: ['points: false'], expected: { points: false } },
    lines: { properties: ['lines'], expected: { lines: true } },
    dragMode: { properties: ['dragMode: Y'], expected: { dragMode: 'Y' } },
};

/** What a folder takes, written on the line of its `{`. */
const FOLDER: Record<string, PropertyCase> = {
    collapsed: { properties: ['collapsed'], expected: { collapsed: true } },
    hidden: { properties: ['hidden'], expected: { hidden: true } },
    secret: { properties: ['secret'], expected: { secret: true } },
};

/**
 * What an import takes. An import is a folder that starts shut, so the case
 * for `collapsed` is the one that opens it - which Desmos says by leaving the
 * key off.
 */
const IMPORT: Record<string, PropertyCase> = {
    collapsed: { properties: ['collapsed: false'], expected: { collapsed: undefined } },
    hidden: { properties: ['hidden'], expected: { hidden: true, collapsed: true } },
    secret: { properties: ['secret'], expected: { secret: true } },
};

const IMAGE_CASES: Record<string, PropertyCase> = {
    name: { properties: ['name: "A"'], expected: { name: 'A' } },
    center: { properties: ['center: (1, 2)'], expected: { center: '\\left(1,2\\right)' } },
    width: { properties: ['width: 4'], expected: { width: '4' } },
    height: { properties: ['height: 3'], expected: { height: '3' } },
    // A sign binds tighter than a division (spec §5.1), so this is (-π)/200.
    angle: { properties: ['angle: -pi / 200'], expected: { angle: '\\frac{-\\pi}{200}' } },
    opacity: { properties: ['opacity: 0.5'], expected: { opacity: '0.5' } },
    foreground: { properties: ['foreground'], expected: { foreground: true } },
    hidden: { properties: ['hidden'], expected: { hidden: true } },
    secret: { properties: ['secret'], expected: { secret: true } },
    // Desmos ignores `dragMode` on an image and keeps a `draggable` flag
    // instead, so that is what the property is lowered to (spec §4.6).
    dragMode: {
        properties: ['dragMode: XY'],
        expected: { draggable: true, dragMode: undefined },
    },
    onClick: {
        setup: 'a = 0',
        properties: ['onClick: a -> a + 1'],
        expected: { clickableInfo: { enabled: true, latex: 'a\\to a+1' } },
    },
    clickable: {
        setup: 'a = 0',
        properties: ['onClick: a -> a + 1', 'clickable: false'],
        expected: { clickableInfo: { latex: 'a\\to a+1' } },
    },
};

const NOTE: Record<string, PropertyCase> = {
    secret: { properties: ['secret'], expected: { secret: true } },
};

/**
 * Each property a style takes, written into a style and applied through `use:`.
 * A style takes anything an expression or a column does, and every one of
 * those is an expression property too, so the expression cases are reused
 * with the clause moved into a style - plus a style that uses another.
 */
const STYLE: Record<string, PropertyCase> = {
    // Everything a style may set, which is nearly everything an expression
    // takes: a regression's residuals are one list, not a look to share.
    ...Object.fromEntries(
        Object.entries(EXPRESSION).filter(([name]) => findProperty(name, 'style')),
    ),
    use: {
        setup: `${THICK}\nstyle outer { use: thick; color: #00ff00 }`,
        statement: 'y = x',
        properties: ['use: outer'],
        expected: { lineWidth: '5', color: '#00ff00' },
    },
};

/**
 * How each placement is written, and where in the applied graph its
 * properties land. `pick` gets the item the compiler emitted for the
 * statement, found in the applied list by the id the compiler gave it, which
 * is steadier than a position: Desmos adds an empty expression of its own
 * after a secret one.
 */
interface Placement {
    cases: Record<string, PropertyCase>;
    source(entry: PropertyCase): string;
    options?: CompileOptions;
    /** Which compiled item carries the properties. */
    find(list: DesmosExpression[]): DesmosExpression | undefined;
    /** Where in that item, once applied, the keys are read. */
    pick(applied: DesmosExpression): Record<string, unknown>[];
}

const lines = (...parts: (string | undefined)[]) => parts.filter(Boolean).join('\n');
const inline = (entry: PropertyCase) => entry.properties.join(', ');
const whole = (item: DesmosExpression) => [item as unknown as Record<string, unknown>];
const last = (list: DesmosExpression[]) => list.at(-1);
const firstFolder = (list: DesmosExpression[]) => list.find(item => item.type === 'folder');

/** The placements this suite covers; `ticker` and `config` have suites of their own. */
const PLACEMENTS: Partial<Record<PropertyPlacement, Placement>> = {
    expression: {
        cases: EXPRESSION,
        source: entry => lines(entry.setup, `${entry.statement} @ ${inline(entry)}`),
        find: last,
        pick: whole,
    },
    column: {
        cases: COLUMN,
        source: entry =>
            lines(entry.setup, `table { x = [1, 2, 3]; y = [4, 5, 6] @ ${inline(entry)} }`),
        find: last,
        pick: item => [(item as Table).columns[1] as unknown as Record<string, unknown>],
    },
    table: {
        // The table's metadata is every column's default (spec §3.2), so it
        // has to arrive on each of them.
        cases: COLUMN,
        source: entry =>
            lines(entry.setup, `table { @ ${inline(entry)}; x = [1, 2, 3]; y = [4, 5, 6] }`),
        find: last,
        pick: item =>
            (item as Table).columns.map(column => column as unknown as Record<string, unknown>),
    },
    folder: {
        cases: FOLDER,
        source: entry => `folder "F" { @ ${inline(entry)}\n    y = x\n}`,
        find: firstFolder,
        pick: whole,
    },
    import: {
        cases: IMPORT,
        source: entry => `import "lib" @ ${inline(entry)}`,
        options: IMPORT_OPTIONS,
        find: firstFolder,
        pick: whole,
    },
    image: {
        cases: IMAGE_CASES,
        source: entry => lines(entry.setup, `image ${IMAGE} @ ${inline(entry)}`),
        find: list => list.find(item => item.type === 'image'),
        pick: whole,
    },
    note: {
        cases: NOTE,
        source: entry => `"A note" @ ${inline(entry)}`,
        find: list => list.find(item => item.type === 'text'),
        pick: whole,
    },
    style: {
        cases: STYLE,
        source: entry =>
            lines(
                entry.setup,
                `style under { ${entry.properties.join('; ')} }`,
                `${entry.statement} @ use: under`,
            ),
        find: last,
        pick: whole,
    },
};

describe('metadata, placement by placement', { skip }, () => {
    const calculator = useCalculator();

    test('every placement is covered here or by a suite of its own', () => {
        const elsewhere = new Set<PropertyPlacement>(['ticker', 'config']);
        const missing = AXIS_PROPERTY_PLACEMENTS.filter(
            placement => !PLACEMENTS[placement] && !elsewhere.has(placement),
        );

        assert.deepEqual(missing, []);
    });

    for (const [placement, { cases }] of Object.entries(PLACEMENTS)) {
        test(`every property ${placement} metadata takes is covered here`, () => {
            const missing = propertiesFor(placement as PropertyPlacement)
                .map(property => property.name)
                .filter(name => !cases[name]);

            assert.deepEqual(missing, [], `${placement} properties with no test`);
        });
    }

    for (const [placement, spec] of Object.entries(PLACEMENTS)) {
        for (const [property, entry] of Object.entries(spec.cases)) {
            const verb = entry.dropped ? 'is dropped by the calculator' : 'reaches the calculator';

            test(`${property} on a ${placement} ${verb}`, async () => {
                const source = spec.source(entry);
                const compiled = compileAxis(source, spec.options);
                assert.deepEqual(
                    compiled.diagnostics.map(diagnostic => diagnostic.message),
                    [],
                    `${source} is not clean`,
                );
                const target = spec.find(compiled.state.expressions?.list ?? []);
                assert.ok(target?.id, `${property} compiled to nothing to look for`);

                await calculator().load(source, spec.options);
                const list = (await calculator().getState()).expressions?.list ?? [];
                const applied = list.find(item => item.id === target.id);
                assert.ok(applied, `${property}'s ${placement} is not in the graph at all`);

                for (const held of spec.pick(applied)) {
                    const actual = Object.fromEntries(
                        Object.keys(entry.expected).map(key => [key, held[key]]),
                    );
                    assert.deepEqual(withoutPlayDirection(actual, entry.expected), entry.expected);
                }
            });
        }
    }

    test('nothing logged to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});

/**
 * Drop a `playDirection` the graph grew rather than the file asked for.
 *
 * Desmos adds one the moment a playing slider turns around at an end, so
 * whether it is on the state depends on how long the graph has been open. A
 * case that sets the direction itself expects it and keeps it; every other key
 * is under test either way.
 */
function withoutPlayDirection(
    state: Record<string, unknown>,
    expected: Record<string, unknown>,
): Record<string, unknown> {
    const slider = state.slider;
    const wanted = expected.slider;

    if (
        slider === null ||
        typeof slider !== 'object' ||
        !('playDirection' in slider) ||
        (typeof wanted === 'object' && wanted !== null && 'playDirection' in wanted)
    ) {
        return state;
    }

    const { playDirection: _ignored, ...rest } = slider as Record<string, unknown>;
    return { ...state, slider: rest };
}

/** Load `source` and return the applied expression the compiler emitted last. */
async function lastApplied(calculator: () => AxisCalculator, source: string): Promise<Expression> {
    const compiled = compileAxis(source);
    assert.deepEqual(compiled.diagnostics, [], `${source} is not clean`);
    const id = compiled.state.expressions?.list?.at(-1)?.id;
    await calculator().load(source);
    const list = (await calculator().getState()).expressions?.list ?? [];
    return list.find(item => item.id === id) as Expression;
}

describe('ranges', { skip }, () => {
    const calculator = useCalculator();

    // Each end is hard unless `soft` says otherwise, an end left off is left
    // to Desmos, and an end or a step may be any expression (spec §4.4).
    const SLIDERS: [string, Record<string, unknown>][] = [
        // Not 0..10: Desmos leaves off a bound that matches its own default.
        ['0..8', { min: '0', max: '8', hardMin: true, hardMax: true }],
        ['..5', { max: '5', hardMin: true, hardMax: true }],
        ['2..', { min: '2', hardMin: true, hardMax: true }],
        ['0..5 soft', { min: '0', max: '5' }],
        ['0..5 soft min', { min: '0', max: '5', hardMax: true }],
        ['0..5 soft max', { min: '0', max: '5', hardMin: true }],
        ['0..5 step 1 soft', { min: '0', max: '5', step: '1' }],
        [
            '-lim..lim step lim / 10',
            {
                min: '-l_{im}',
                max: 'l_{im}',
                step: '\\frac{l_{im}}{10}',
                hardMin: true,
                hardMax: true,
            },
        ],
    ];

    for (const [range, expected] of SLIDERS) {
        test(`slider: ${range} is the slider Desmos holds`, async () => {
            const slider = await lastApplied(calculator, `lim = 3\na = 1 @ slider: ${range}`);

            assert.deepEqual(slider.slider, expected);
            assert.deepEqual(await calculator().getErrors(), []);
        });
    }

    test('a hard bound clamps the value it starts from', async () => {
        // Desmos pulls a defined value inside hard bounds rather than keeping
        // a starting value the slider could never return to.
        await calculator().load('a = 99 @ slider: 0..10');

        assert.equal((await calculator().evaluate('a')).numericValue, 10);
    });

    test('a soft bound lets the value it starts from stand', async () => {
        await calculator().load('a = 99 @ slider: 0..10 soft');

        assert.equal((await calculator().evaluate('a')).numericValue, 99);
    });

    test('soft max softens only the top', async () => {
        await calculator().load(
            'a = 99 @ slider: 0..10 soft max\nb = -99 @ slider: 0..10 soft max',
        );

        assert.equal((await calculator().evaluate('a')).numericValue, 99);
        assert.equal((await calculator().evaluate('b')).numericValue, 0);
    });

    test('bounds read from the graph are the bounds the slider keeps to', async () => {
        await calculator().load('lim = 3\na = 99 @ slider: -lim..lim');

        assert.equal((await calculator().evaluate('a')).numericValue, 3);
    });

    test('a starting value off the step is moved onto it', async () => {
        // Desmos snaps a stepped slider's value to its grid, counted from the
        // bottom - so `a = 1` with a step of 0.3 from -3 starts at 0.9.
        await calculator().load('lim = 3\na = 1 @ slider: -lim..lim step lim / 10');

        assert.ok(Math.abs((await calculator().evaluate('a')).numericValue - 0.9) < 1e-9);
    });

    test('a domain with an end left off keeps that end empty', async () => {
        // Desmos stores both ends of a domain, an absent one as the empty
        // string. It fills its own default into `domain` as it reads the
        // state, and leaves the older `parametricDomain` copy as it was given.
        const curve = await lastApplied(calculator, '(cos(t), sin(t)) @ domain: 0..');

        assert.deepEqual(curve.parametricDomain, { min: '0', max: '' });
        assert.deepEqual(curve.domain, { min: '0', max: '1' });
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a domain bound may be an expression', async () => {
        const curve = await lastApplied(calculator, 'k = 2\n(cos(t), sin(t)) @ domain: -k..k pi');

        assert.deepEqual(curve.domain, { min: '-k', max: 'k\\pi' });
        assert.deepEqual(await calculator().getErrors(), []);
    });
});

describe('colours', { skip }, () => {
    const calculator = useCalculator();

    test('a hex colour is written out in full, in lower case', async () => {
        const curve = await lastApplied(calculator, 'y = x @ color: #ABC');

        assert.equal(curve.color, '#aabbcc');
    });

    for (const { name, hex } of AXIS_PALETTE) {
        test(`${name} is the palette's ${hex}`, async () => {
            const curve = await lastApplied(calculator, `y = x @ color: ${name}`);

            assert.equal(curve.color, hex);
            assert.equal(curve.colorLatex, undefined);
        });
    }

    test('any other expression is a colour Desmos works out', async () => {
        const curve = await lastApplied(calculator, 'hue = 120\ny = x @ color: hsv(hue, 1, 1)');

        assert.equal(curve.colorLatex, '\\operatorname{hsv}\\left(h_{ue},1,1\\right)');
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a colour defined once is used by name', async () => {
        const curve = await lastApplied(
            calculator,
            'warm = rgb(230, 120, 40)\ny = x @ color: warm',
        );

        assert.equal(curve.colorLatex, 'w_{arm}');
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a list of colours colours each point of a list', async () => {
        await lastApplied(calculator, 'K = [0...9]\n(K, 0) @ color: hsv(36K, 1, 1)');
        const [, points] = await calculator().inspectExpressions();

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal(points.analysis?.isGraphable, true);
    });

    test('a palette name in the wrong case is not a colour', async () => {
        // `red` is r·e·d, three sliders nobody asked for: an error, and the
        // colour is left to Desmos rather than drawn from three variables.
        const compiled = compileAxis('y = x @ color: red');

        assert.deepEqual(
            compiled.diagnostics.map(diagnostic => diagnostic.code),
            ['invalid-color'],
        );
        const [curve] = compiled.state.expressions?.list ?? [];
        assert.equal((curve as Expression).colorLatex, undefined);
    });

    test('unless the file defines that name itself', async () => {
        const curve = await lastApplied(calculator, 'red = rgb(255, 0, 0)\ny = x @ color: red');

        assert.equal(curve.colorLatex, 'r_{ed}');
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a column takes an expression colour too', async () => {
        await calculator().load('table { x = [1, 2]; y = [3, 4] @ color: rgb(0, 200, 0) }');
        const [table] = (await calculator().getState()).expressions?.list ?? [];
        const [, column] = (table as Table).columns;

        assert.equal(column.colorLatex, '\\operatorname{rgb}\\left(0,200,0\\right)');
        assert.deepEqual(await calculator().getErrors(), []);
    });
});

describe('bare flags', { skip }, () => {
    const calculator = useCalculator();

    test('a boolean written on its own means true', async () => {
        const region = await lastApplied(calculator, 'y < x @ hidden, fill, secret');

        assert.equal(region.hidden, true);
        assert.equal(region.fill, true);
        assert.equal(region.secret, true);
    });

    test('and compiles exactly as `: true` does', () => {
        assert.deepEqual(
            compileAxis('(1, 2) @ label: "P", showLabel, pointOutline').state,
            compileAxis('(1, 2) @ label: "P", showLabel: true, pointOutline: true').state,
        );
    });

    test('a flag between two properties is still a flag', async () => {
        const point = await lastApplied(
            calculator,
            '(1, 2) @ label: "P", showLabel, pointSize: 20',
        );

        assert.equal(point.showLabel, true);
        assert.equal(point.pointSize, '20');
    });
});

/**
 * The styles Desmos added in its v1.12 point overhaul. A graph state keeps them
 * out of `pointStyle`, where an older calculator reading the state would not
 * know them, and under `__stashed_V12PointStyle` instead - fixed point or
 * movable, whatever `doNotMigrateMovablePointStyle` says.
 */
const V12_POINT_STYLES = ['SQUARE', 'PLUS', 'TRIANGLE', 'DIAMOND', 'STAR'];

/** The point style an applied expression holds, wherever Desmos filed it. */
function pointStyleOf(expression: Expression): unknown {
    const record = expression as unknown as Record<string, unknown>;
    return record.pointStyle ?? record.__stashed_V12PointStyle;
}

describe('enum values', { skip }, () => {
    const calculator = useCalculator();

    const pointStyle = findProperty('pointStyle', 'expression');
    for (const value of pointStyle?.values ?? []) {
        test(`pointStyle: ${value} reaches the calculator`, async () => {
            const point = await lastApplied(calculator, `(1, 2) @ pointStyle: ${value}`);
            // POINT is Desmos' default, which it writes by leaving it off.
            const kept = V12_POINT_STYLES.includes(value) || value === 'POINT' ? undefined : value;

            assert.equal(pointStyleOf(point) ?? 'POINT', value);
            assert.equal(point.pointStyle, kept);
        });
    }

    test('every lineStyle and dragMode reaches the calculator', async () => {
        for (const name of ['lineStyle', 'dragMode', 'labelOrientation', 'loopMode']) {
            for (const value of findProperty(name, 'expression')?.values ?? []) {
                const source =
                    name === 'loopMode'
                        ? `a = 1 @ slider: 0..8, loopMode: ${value}`
                        : `(1, 2) @ label: "P", ${name}: ${value}`;
                const applied = (await lastApplied(calculator, source)) as unknown as Record<
                    string,
                    unknown
                >;
                const held =
                    name === 'loopMode'
                        ? (applied.slider as Record<string, unknown>).loopMode
                        : applied[name];

                // Desmos writes a default back by leaving it off.
                assert.ok(
                    held === value || held === undefined,
                    `${name}: ${value} came back as ${String(held)}`,
                );
            }
        }
    });

    test('are read in any case, and reach Desmos spelt its way', async () => {
        // Desmos wants `DASHED` and `above` and ignores anything else in
        // silence, so the spelling it takes is the compiler's job.
        const point = await lastApplied(
            calculator,
            '(1, 2) @ label: "P", labelOrientation: ABOVE, pointStyle: square, dragMode: none',
        );

        assert.equal(point.labelOrientation, 'above');
        assert.equal(pointStyleOf(point), 'SQUARE');
        assert.equal(point.dragMode, 'NONE');
    });
});

describe('metadata Desmos acts on', { skip }, () => {
    const calculator = useCalculator();

    test('a hidden expression is still analyzed', async () => {
        await calculator().load('a = 6 * 7 @ hidden');
        const [expression] = await calculator().inspectExpressions();

        assert.deepEqual(expression.analysis?.evaluation, { type: 'Number', value: 42 });
    });

    test('a playing slider actually animates', async () => {
        await calculator().load('t = 0 @ slider: 0..10 step 0.1, playing');
        const first = (await calculator().evaluate('t')).numericValue;
        await new Promise(resolve => setTimeout(resolve, 400));
        const second = (await calculator().evaluate('t')).numericValue;

        assert.notEqual(first, second, 'the slider never moved');
    });

    test('an onClick action runs when the point is clicked', async () => {
        await calculator().load(
            'a = 0 @ slider: 0..10 step 1\n(1, 2) @ onClick: a -> a + 1, pointSize: 30',
        );
        assert.equal((await calculator().evaluate('a')).numericValue, 0);

        assert.ok(await calculator().click({ x: 1, y: 2 }), 'the point was off screen');

        assert.equal((await calculator().evaluate('a')).numericValue, 1);
    });

    test('an action run needs no brackets, and every action in it runs', async () => {
        // The comma rule (spec §4.1): `b -> 2` is part of the run, and
        // `pointSize: 30` - a name and a colon - starts the next property.
        const source = 'a = 0\nb = 0\n(1, 2) @ onClick: a -> 1, b -> 2, pointSize: 30';
        const compiled = compileAxis(source);
        const point = compiled.state.expressions?.list?.at(-1) as Expression;
        assert.deepEqual(compiled.diagnostics, []);
        assert.equal(point.pointSize, '30');

        await calculator().load(source);
        assert.ok(await calculator().click({ x: 1, y: 2 }), 'the point was off screen');

        assert.equal((await calculator().evaluate('a')).numericValue, 1);
        assert.equal((await calculator().evaluate('b')).numericValue, 2);
    });

    test('a named run is an action anywhere one goes', async () => {
        await calculator().load(
            'a = 5\nb = 5\nreset = a -> 0, b -> 0\n(1, 2) @ onClick: reset, pointSize: 30',
        );
        assert.ok(await calculator().click({ x: 1, y: 2 }), 'the point was off screen');

        assert.equal((await calculator().evaluate('a')).numericValue, 0);
        assert.equal((await calculator().evaluate('b')).numericValue, 0);
    });

    test('a point the file says nothing about is still Desmos’ to drag', async () => {
        // A property the file never wrote has to reach Desmos as a missing
        // key, not as an undefined one: `dragMode: undefined` reads as present,
        // and Desmos stops deciding for itself - the point arrives frozen where
        // `AUTO` would have let it be dragged along its slider. `getState` shows
        // nothing of this either way; `getExpressions` is where the default is.
        await calculator().load('a = 1 @ slider: 0..5\n(a, 2)');
        const [, point] = await calculator().getExpressions();

        assert.equal((point as Expression).dragMode, 'AUTO');
    });

    test('a draggable point is drawn the way the file asked, not Desmos’ way', async () => {
        // Desmos draws a point it decides is movable with a style and a size of
        // its own: the author's style goes into a stash, and `pointSize` is
        // ignored in favour of `movablePointSize`. So a big square point
        // silently arrives as a small round one the moment its coordinates turn
        // out to be draggable - which is what makes this worth pinning.
        //
        // Neither is anything a file should have to know. Axis applies every
        // graph with `doNotMigrateMovablePointStyle` for the style, and
        // compiles `pointSize` into both sizes; the source below says neither.
        const point = (await lastApplied(
            calculator,
            'a = 1\nb = 2\n(a, b) @ pointStyle: SQUARE, pointSize: 30',
        )) as unknown as Record<string, unknown>;

        // The style comes back under the stashed key: that is simply where a
        // movable point's style lives, and undoing that is an importer's job.
        assert.equal(point.__stashed_V12PointStyle ?? point.pointStyle, 'SQUARE');
        // Desmos drops this from a point it does not consider movable, so it
        // surviving is also the assertion that the point still is one.
        assert.equal(point.movablePointSize, '30');
    });

    test('a secret folder is secret in the graph', async () => {
        await calculator().load('folder "S" { @ secret\n    y = x\n}');
        const [folder] = (await calculator().getState()).expressions?.list ?? [];

        assert.equal((folder as Folder).secret, true);
    });

    test('an image dragged by nothing is not draggable', async () => {
        await calculator().load(`image ${IMAGE} @ dragMode: NONE`);
        const [image] = (await calculator().getState()).expressions?.list ?? [];

        assert.equal((image as GraphImage).draggable, undefined);
    });

    test('the compiler leaves colour to Desmos when none is given', async () => {
        await calculator().load('y = x\ny = 2x\ny = 3x');
        const list = ((await calculator().getState()).expressions?.list ?? []) as Expression[];
        const colors = list.map(expression => expression.color);

        assert.equal(new Set(colors).size, 3, `expected three colors, got ${colors.join(', ')}`);
    });

    test('a metadata block reaches the graph the way a trailing clause does', async () => {
        const block = await lastApplied(
            calculator,
            'y = sin(x) @{\n    color: #c74440\n    lineStyle: DASHED\n    label: "a wave"\n}',
        );

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal(block.color, '#c74440');
        assert.equal(block.lineStyle, 'DASHED');
        assert.equal(block.label, 'a wave');
        assert.deepEqual(
            compileAxis(
                'y = sin(x) @{\n    color: #c74440\n    lineStyle: DASHED\n    label: "a wave"\n}',
            ).state,
            compileAxis('y = sin(x) @ color: #c74440, lineStyle: DASHED, label: "a wave"').state,
        );
    });

    test('a statement spread over lines keeps its metadata', async () => {
        // A statement continues while its brackets are open, so a polygon can
        // be written a vertex to a line and still carry its clause at the end.
        const wrapped = 'A = polygon(\n    (0, 0),\n    (1, 0),\n    (1, 1)\n) @ color: #ff0000';
        assert.deepEqual(
            (compileAxis(wrapped).state.expressions?.list as Expression[]).map(
                ({ latex, color }) => ({ latex, color }),
            ),
            [
                {
                    latex: 'A=\\operatorname{polygon}\\left(\\left(0,0\\right),\\left(1,0\\right),\\left(1,1\\right)\\right)',
                    color: '#ff0000',
                },
            ],
        );

        await calculator().load(wrapped);
        const [expression] = await calculator().inspectExpressions();

        assert.equal(expression.analysis?.isGraphable, true);
        assert.deepEqual(await calculator().getErrors(), []);
    });
});
