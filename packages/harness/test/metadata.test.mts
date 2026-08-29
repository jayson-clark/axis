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
import type { Expression, Folder, GraphImage } from '@axis-dsl/desmos';
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
    /**
     * Set for a property Desmos writes into a state and then refuses to read
     * back out of one. `expected` is what the applied graph holds instead, so
     * the surprise is pinned rather than skipped.
     */
    dropped?: true;
}

/** A 1x1 transparent GIF, quoted as the `image` statement takes it. */
const IMAGE = '"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"';

const PROPERTIES: Record<string, PropertyCase> = {
    color: { source: 'y = x # color: #ff0000', expected: { color: '#ff0000' } },
    colorLatex: {
        source: 'C = rgb(255, 0, 0)\ny = x # colorLatex: C',
        expected: { colorLatex: 'C' },
    },
    lineStyle: { source: 'y = x # lineStyle: DASHED', expected: { lineStyle: 'DASHED' } },
    lineWidth: { source: 'y = x # lineWidth: 5', expected: { lineWidth: '5' } },
    lineOpacity: { source: 'y = x # lineOpacity: 0.3', expected: { lineOpacity: '0.3' } },
    pointStyle: { source: '(1, 2) # pointStyle: OPEN', expected: { pointStyle: 'OPEN' } },
    pointSize: { source: '(1, 2) # pointSize: 20', expected: { pointSize: '20' } },
    // Only a *draggable* point keeps this. Desmos drops it from a point whose
    // coordinates are literals, since such a point can never be moved — which
    // is why the case defines the coordinates as free variables first.
    movablePointSize: {
        source: 'a = 1\nb = 2\n(a, b) # movablePointSize: 20',
        expected: { movablePointSize: '20' },
        at: 2,
    },
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
    suppressTextOutline: {
        source: '(1, 2) # label: "P", showLabel: true, suppressTextOutline: true',
        expected: { suppressTextOutline: true },
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
    loopMode: {
        source: 'a = 5 # sliderBounds: {min: 1, max: 9}, playing: true, loopMode: LOOP_FORWARD',
        expected: {
            slider: {
                min: '1',
                max: '9',
                hardMin: true,
                hardMax: true,
                isPlaying: true,
                loopMode: 'LOOP_FORWARD',
            },
        },
    },
    playDirection: {
        source: 'a = 5 # sliderBounds: {min: 1, max: 9}, playDirection: -1',
        expected: {
            slider: { min: '1', max: '9', hardMin: true, hardMax: true, playDirection: -1 },
        },
    },
    // Desmos writes this into a graph it saves and drops it from one it is
    // given, playing or not - so a script can carry the speed a graph was
    // saved with, and no more. The compiler still emits it, which is what
    // keeps a decompiled graph the graph it was read from.
    animationPeriod: {
        source: 'a = 5 # sliderBounds: {min: 1, max: 9}, playing: true, animationPeriod: 4000',
        expected: {
            slider: { min: '1', max: '9', hardMin: true, hardMax: true, isPlaying: true },
        },
        dropped: true,
    },
    pointOutline: {
        source: '(1, 2) # pointOutline: true',
        expected: { pointOutline: true },
    },
    // Desmos keeps the same bounds twice, so one property in the script sets
    // both keys; `parametricDomain` is the second of them written on its own.
    domain: {
        source: '(cos(t), sin(t)) # domain: {min: 0, max: 2pi}',
        expected: {
            domain: { min: '0', max: '2\\pi' },
            parametricDomain: { min: '0', max: '2\\pi' },
        },
    },
    parametricDomain: {
        source: '(cos(t), sin(t)) # domain: {min: 0, max: 2pi}, parametricDomain: {min: 0.5, max: 2pi}',
        expected: { parametricDomain: { min: '0.5', max: '2\\pi' } },
    },
    polarDomain: {
        source: 'config {\n    polarMode: true\n}\nr = theta # polarDomain: {min: 0, max: 2pi}',
        expected: { polarDomain: { min: '0', max: '2\\pi' } },
    },
    name: { source: `image ${IMAGE} # name: "A"`, expected: { name: 'A' } },
    center: {
        source: `image ${IMAGE} # center: (1, 2)`,
        expected: { center: '\\left(1,2\\right)' },
    },
    width: { source: `image ${IMAGE} # width: 4`, expected: { width: '4' } },
    height: { source: `image ${IMAGE} # height: 3`, expected: { height: '3' } },
    angle: {
        source: `image ${IMAGE} # angle: -pi / 200`,
        expected: { angle: '-\\frac{\\pi}{200}' },
    },
    opacity: { source: `image ${IMAGE} # opacity: 0.5`, expected: { opacity: '0.5' } },
    foreground: { source: `image ${IMAGE} # foreground: true`, expected: { foreground: true } },
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

    for (const [property, { source, expected, at, dropped }] of Object.entries(PROPERTIES)) {
        test(`${property} ${dropped ? 'is dropped by the calculator' : 'reaches the calculator'}`, async () => {
            const compiled = compileAxis(source).expressions;
            const target = compiled.at(at ?? -1);
            assert.ok(target?.id, `${property} compiled to nothing to look for`);

            await calculator().load(source);
            const list = (await calculator().getState()).expressions?.list ?? [];
            const applied = list.find(expression => expression.id === target.id) as Expression &
                Folder &
                GraphImage;
            assert.ok(applied, `${property}'s expression is not in the graph at all`);

            const actual = Object.fromEntries(
                Object.keys(expected).map(key => [key, applied[key as keyof typeof applied]]),
            );

            assert.deepEqual(withoutPlayDirection(actual, expected), expected);
        });
    }

    test('a draggable point is drawn the way the script asked, not Desmos’ way', async () => {
        // Desmos draws a point it decides is movable with a style and a size of
        // its own: the author's style goes into a stash, and `pointSize` is
        // ignored in favour of `movablePointSize`. So a big square point
        // silently arrives as a small round one the moment its coordinates turn
        // out to be draggable — which is what makes this worth pinning.
        //
        // Neither is anything a script should have to know. Axis applies every
        // graph with `doNotMigrateMovablePointStyle` for the style, and
        // compiles `pointSize` into both sizes; the script below says neither.
        await calculator().load('a = 1\nb = 2\n(a, b) # pointStyle: SQUARE, pointSize: 30');
        const list = (await calculator().getState()).expressions?.list ?? [];
        const point = list.find(entry => (entry as Expression).latex?.includes('a,b')) as Record<
            string,
            unknown
        >;

        assert.ok(point, 'the point is not in the graph at all');
        // The style comes back under the stashed key: that is simply where a
        // movable point's style lives, and undoing that is an importer's job.
        assert.equal(point.__stashed_V12PointStyle ?? point.pointStyle, 'SQUARE');
        // Desmos drops this from a point it does not consider movable, so it
        // surviving is also the assertion that the point still is one.
        assert.equal(point.movablePointSize, '30');
    });
});

/**
 * Drop a `playDirection` the graph grew rather than the script asked for.
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

    test('a point the script says nothing about is still Desmos\u2019 to drag', async () => {
        // A property the script never wrote has to reach Desmos as a missing
        // key, not as an undefined one: `dragMode: undefined` reads as present,
        // and Desmos stops deciding for itself - the point arrives frozen where
        // `AUTO` would have let it be dragged along its slider. `getState` shows
        // nothing of this either way; `getExpressions` is where the default is.
        await calculator().load('a = 1 # sliderBounds: {min: 0, max: 5}\n(a, 2)');
        const [, point] = await calculator().getExpressions();

        assert.equal((point as Expression).dragMode, 'AUTO');
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
