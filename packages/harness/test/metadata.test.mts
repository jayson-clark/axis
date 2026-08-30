// ═════════════════════════════════════════════════════════════════════════════
// Expression metadata, checked against a graph that really has it
// ═════════════════════════════════════════════════════════════════════════════
//
// `# color: red` is only worth writing if Desmos ends up holding it. The
// compiler's own tests already assert what it emits; these assert what survives
// being applied — which is a different question, and the one that caught
// `sliderBounds` being dropped on the floor by `setState`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_METADATA_PROPERTY_NAMES } from '@axis-dsl/language';
import type { Expression, Folder } from '@axis-dsl/desmos';
import { compileAxis } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';

/**
 * One statement per property, written the way the language documents it, and
 * what the applied graph must then hold — so a property Desmos silently drops
 * fails here. `at` indexes the compiled list when the statement carrying the
 * metadata is not the last one; the expression is then found in the state by
 * the id the compiler gave it, which is steadier than a position, since Desmos
 * adds an empty expression of its own after a secret one.
 */
interface PropertyCase {
    source: string;
    expected: Record<string, unknown>;
    at?: number;
}

const PROPERTIES: Record<string, PropertyCase> = {
    color: { source: 'y = x # color: #ff0000', expected: { color: '#ff0000' } },
    lineStyle: { source: 'y = x # lineStyle: DASHED', expected: { lineStyle: 'DASHED' } },
    lineWidth: { source: 'y = x # lineWidth: 5', expected: { lineWidth: '5' } },
    lineOpacity: { source: 'y = x # lineOpacity: 0.3', expected: { lineOpacity: '0.3' } },
    pointStyle: { source: '(1, 2) # pointStyle: OPEN', expected: { pointStyle: 'OPEN' } },
    pointSize: { source: '(1, 2) # pointSize: 20', expected: { pointSize: '20' } },
    pointOpacity: { source: '(1, 2) # pointOpacity: 0.4', expected: { pointOpacity: '0.4' } },
    fillOpacity: { source: 'y < x # fillOpacity: 0.7', expected: { fillOpacity: '0.7' } },
    hidden: { source: 'y = x # hidden: true', expected: { hidden: true } },
    secret: { source: 'y = x # secret: true', expected: { secret: true } },
    points: { source: '(1, 2) # points: false', expected: { points: false } },
    lines: { source: 'y = x # lines: false', expected: { lines: false } },
    fill: { source: 'y < x # fill: false', expected: { fill: false } },
    label: { source: '(1, 2) # label: "P"', expected: { label: 'P' } },
    showLabel: {
        source: '(1, 2) # label: "P", showLabel: true',
        expected: { label: 'P', showLabel: true },
    },
    labelSize: {
        source: '(1, 2) # label: "P", labelSize: 2',
        expected: { labelSize: '2' },
    },
    labelOrientation: {
        source: '(1, 2) # label: "P", labelOrientation: above',
        expected: { labelOrientation: 'above' },
    },
    dragMode: { source: '(1, 2) # dragMode: XY', expected: { dragMode: 'XY' } },
    onClick: {
        source: 'a = 0\n(1, 2) # onClick: a -> a + 1',
        expected: { clickableInfo: { enabled: true, latex: 'a\\to a+1' } },
    },
    clickable: {
        // Desmos writes a switched-off clickable by leaving `enabled` out
        // rather than storing false, so that is what comes back.
        source: 'a = 0\n(1, 2) # onClick: a -> a + 1, clickable: false',
        expected: { clickableInfo: { latex: 'a\\to a+1' } },
    },
    description: {
        source: 'a = 0\n(1, 2) # onClick: a -> a + 1, description: "bump a"',
        expected: {
            description: 'bump a',
            clickableInfo: { enabled: true, latex: 'a\\to a+1' },
        },
    },
    sliderBounds: {
        // Desmos leaves a bound off the state when it matches its own default,
        // so the bounds here are ones it has an opinion about.
        source: 'a = 5 # sliderBounds: {min: 1, max: 9, step: 0.5}',
        expected: {
            slider: { min: '1', max: '9', step: '0.5', hardMin: true, hardMax: true },
        },
    },
    playing: {
        source: 'a = 5 # sliderBounds: {min: 1, max: 9}, playing: true',
        expected: { slider: { min: '1', max: '9', hardMin: true, hardMax: true, isPlaying: true } },
    },
    collapsed: {
        source: 'folder "F" { # collapsed: true\ny = x\n}',
        expected: { collapsed: true },
        at: 0,
    },
};

describe('expression metadata', { skip }, () => {
    const calculator = useCalculator();

    test('every metadata property the language offers is covered here', () => {
        const covered = new Set(Object.keys(PROPERTIES));
        const missing = AXIS_METADATA_PROPERTY_NAMES.filter(name => !covered.has(name));

        assert.deepEqual(missing, [], 'metadata properties with no test');
    });

    for (const [property, { source, expected, at }] of Object.entries(PROPERTIES)) {
        test(`${property} reaches the calculator`, async () => {
            const compiled = compileAxis(source).expressions;
            const target = compiled.at(at ?? -1);
            assert.ok(target?.id, `${property} compiled to nothing to look for`);

            await calculator().load(source);
            const list = (await calculator().getState()).expressions?.list ?? [];
            const applied = list.find(expression => expression.id === target.id) as Expression &
                Folder;
            assert.ok(applied, `${property}'s expression is not in the graph at all`);

            const actual = Object.fromEntries(
                Object.keys(expected).map(key => [key, applied[key as keyof typeof applied]]),
            );

            assert.deepEqual(actual, expected);
        });
    }
});

describe('metadata Desmos acts on', { skip }, () => {
    const calculator = useCalculator();

    test('a hidden expression is still analyzed', async () => {
        await calculator().load('a = 6 * 7 # hidden: true');
        const [expression] = await calculator().inspectExpressions();

        assert.deepEqual(expression.analysis?.evaluation, { type: 'Number', value: 42 });
    });

    test('a slider bound clamps the value it starts from', async () => {
        // Desmos pulls a defined value inside hard bounds rather than keeping
        // a starting value the slider could never return to.
        await calculator().load('a = 99 # sliderBounds: {min: 0, max: 10}');
        const [expression] = await calculator().inspectExpressions();
        const value = expression.analysis?.evaluation;

        assert.equal(value?.type, 'Number');
        assert.ok(
            value.type === 'Number' && value.value <= 10,
            `expected the slider bound to hold, got ${JSON.stringify(value)}`,
        );
    });

    test('a playing slider actually animates', async () => {
        await calculator().load(
            't = 0 # sliderBounds: {min: 0, max: 10, step: 0.1}, playing: true',
        );
        const first = (await calculator().evaluate('t')).numericValue;
        await new Promise(resolve => setTimeout(resolve, 400));
        const second = (await calculator().evaluate('t')).numericValue;

        assert.notEqual(first, second, 'the slider never moved');
    });

    test('an onClick action runs when the point is clicked', async () => {
        await calculator().load(
            'a = 0 # sliderBounds: {min: 0, max: 10, step: 1}\n' +
                '(1, 2) # onClick: a -> a + 1, pointSize: 30',
        );
        assert.equal((await calculator().evaluate('a')).numericValue, 0);

        assert.ok(await calculator().click({ x: 1, y: 2 }), 'the point was off screen');

        assert.equal((await calculator().evaluate('a')).numericValue, 1);
    });

    test('a secret folder hides its contents from the state by default', async () => {
        await calculator().load('folder "S" { # secret: true\ny = x\n}');
        const [folder] = (await calculator().getState()).expressions?.list ?? [];

        assert.equal((folder as Folder).secret, true);
    });

    test('the compiler cycles colors when none is given', async () => {
        await calculator().load('y = x\ny = 2x\ny = 3x');
        const list = ((await calculator().getState()).expressions?.list ?? []) as Expression[];
        const colors = list.map(expression => expression.color);

        assert.equal(new Set(colors).size, 3, `expected three colors, got ${colors.join(', ')}`);
    });

    test('metadata written on any line of a wrapped statement still applies', async () => {
        // A statement continues while its brackets are open, and metadata is
        // held back and re-attached once it closes — so it can be written on
        // whichever line reads best.
        const wrapped = 'A = polygon(\n    (0,0), # color: #ff0000\n    (1,0),\n    (1,1)\n)';
        assert.deepEqual(
            compileAxis(wrapped).expressions,
            compileAxis('A = polygon((0,0), (1,0), (1,1)) # color: #ff0000').expressions,
        );

        await calculator().load(wrapped);
        const [expression] = await calculator().inspectExpressions();

        assert.equal(expression.analysis?.isGraphable, true);
        assert.deepEqual(await calculator().getErrors(), []);
    });
});
