// ═════════════════════════════════════════════════════════════════════════════
// Decompiling what Desmos itself keeps
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler's own suite already pins `compile ∘ decompile ∘ compile`, which
// is the round trip over the graph Axis emitted. This is the other one, and the
// only place it can be run: the graph *Desmos* hands back, which is not the
// same object. It normalises what it is given - a bound that matches its
// default is left off, a clickable that is switched off keeps no `enabled`, a
// point style it will not draw on a movable point is stashed under a key of its
// own, every expression grows the colour it was cycled - and the latex comes
// back the way Desmos writes it rather than the way the compiler did.
//
// So every graph here is applied, read back off the calculator with
// `getState`, decompiled from that, compiled and applied again: whatever the
// second state is missing, the decompiler failed to read.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { CalculatorOptions, Expression, ExpressionState, GraphState } from '@axis-dsl/desmos';
import { compileAxis, decompileAxis } from '@axis-dsl/compiler';
import { readAxisFile } from '../dist/index.js';
import type { AxisCalculator } from '../dist/index.js';
import { example, exampleDirectory, skip, useCalculator } from './support.mts';

type Comparable = Record<string, unknown>;

/**
 * A state as it can be compared between two loads of the same graph.
 *
 * Items are compared by where they stand rather than by their ids, since a
 * graph saved at desmos.com names them its own way and the file it
 * decompiles to names them the compiler's; and the blank rows Desmos keeps for
 * spacing are left out, since there is no statement that writes one.
 *
 * A slider that is animating has moved on between one `getState` and the
 * next, so its value and the direction it is travelling in are left out; the
 * bounds it is animating between are not - those are the graph. A playing
 * ticker moves whatever its action names, and nothing in the state says which
 * definitions it will reach, so while one runs every definition is compared by
 * its name alone. The seed is compared only for a graph that draws random
 * numbers: any other is handed a fresh one on every load, and nothing about it
 * depends on which.
 *
 * And an expression coloured by `colorLatex` is compared without the `color`
 * Desmos cycled onto it: Axis writes one colour or the other (spec §4.3), the
 * expression is the one Desmos draws with, and which palette colour the cycle
 * happened to reach depends on how many expressions before it had one.
 */
function comparable(state: GraphState): Comparable {
    const ticking = state.expressions?.ticker?.playing === true;
    const blank = (item: ExpressionState) =>
        (item.type ?? 'expression') === 'expression' &&
        !('text' in item) &&
        !(item as Expression).latex;
    const items = (state.expressions?.list ?? []).filter(item => !blank(item));
    const position = new Map(items.map((item, index) => [item.id, index]));

    const list = items.map(item => {
        const { id: _id, folderId, slider, latex, color, colorLatex, ...rest } = item as Expression;
        const columns = (item as { columns?: { id?: string }[] }).columns;
        const moving = slider?.isPlaying === true || ticking;
        return {
            ...rest,
            ...(folderId !== undefined && { folder: position.get(folderId) }),
            ...(colorLatex === undefined ? color !== undefined && { color } : { colorLatex }),
            ...(columns && { columns: columns.map(({ id: _column, ...column }) => column) }),
            ...(slider && {
                slider: { ...slider, ...(slider.isPlaying && { playDirection: 0 }) },
            }),
            ...(latex !== undefined && { latex: moving ? latex.split('=')[0] : latex }),
        };
    });
    const random = /\\operatorname\{(?:random|shuffle)\}/.test(JSON.stringify(state.expressions));
    const { randomSeed, expressions, ...rest } = state;
    return {
        ...rest,
        ...(random && { randomSeed }),
        expressions: { ...expressions, list },
    };
}

/**
 * What a value sets, without what it sets it to: the keys all the way down,
 * and every other scalar but a string - a string being latex as often as not,
 * and latex the compiler spells its own way.
 */
function keysOf(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(keysOf);
    if (value === null || typeof value !== 'object') {
        return typeof value === 'string' ? 'string' : value;
    }
    return Object.fromEntries(
        Object.entries(value as Comparable).map(([key, inner]) => [key, keysOf(inner)]),
    );
}

/** The settings a calculator reports, without the bookkeeping that differs per load. */
function settingsOf(settings: CalculatorOptions): Comparable {
    const {
        guid: _guid,
        __observers: _observers,
        randomSeed: _seed,
        ...rest
    } = settings as Comparable;
    return rest;
}

/**
 * Decompile what the calculator holds now, apply the source that comes back,
 * and hand back the source - having checked it parsed and compiled cleanly.
 */
async function reload(
    calculator: AxisCalculator,
    options?: CalculatorOptions,
): Promise<{ source: string; before: GraphState }> {
    const before = await calculator.getState();
    const { source, diagnostics } = decompileAxis({ state: before, options });
    assert.deepEqual(diagnostics, [], source);

    const compiled = await calculator.load(source);
    assert.deepEqual(compiled.diagnostics, [], `decompiled source has problems:\n${source}`);
    return { source, before };
}

/** Apply a state, read it back, round-trip it, and demand the same state again. */
async function assertRoundTrip(
    calculator: AxisCalculator,
    options?: CalculatorOptions,
): Promise<string> {
    const { source, before } = await reload(calculator, options);
    const after = await calculator.getState();
    assert.deepEqual(
        comparable(after),
        comparable(before),
        `the decompiled graph came back different:\n${source}`,
    );
    return source;
}

describe('a graph read back off the calculator', { skip }, () => {
    const calculator = useCalculator();

    const files = readdirSync(exampleDirectory()).filter(name => name.endsWith('.axis'));

    for (const name of files) {
        test(`${name} decompiles to the same graph`, async () => {
            const file = await readAxisFile(example(name));
            const loaded = await calculator().load(file.source, {
                path: file.path,
                resolveImport: file.resolveImport,
                resolveImage: file.resolveImage,
            });
            const settings = settingsOf(await calculator().getSettings());

            // The options are the ones the host applied, which is what a
            // graph in an editor has to hand: a calculator's own `settings`
            // carry every default it has as well.
            await assertRoundTrip(calculator(), loaded.options);

            assert.deepEqual(await calculator().getErrors(), []);
            assert.deepEqual(settingsOf(await calculator().getSettings()), settings);
        });
    }

    test('a calculator’s whole settings decompile to the same settings', async () => {
        // Every default spelled out is noise in a file, but not wrong: the
        // settings come back as they were.
        const file = await readAxisFile(example('15-config.axis'));
        await calculator().load(file.source, { path: file.path });
        const settings = await calculator().getSettings();

        await assertRoundTrip(calculator(), settings);
        assert.deepEqual(settingsOf(await calculator().getSettings()), settingsOf(settings));
    });

    test('none of them logged anything to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});

describe('what Desmos leaves out of a graph state', { skip }, () => {
    const calculator = useCalculator();

    test('a bound left off because it is the default comes back left off', async () => {
        // Desmos drops `max: 10`, since 10 is the max it would have assumed -
        // so an absent bound is the default, not no slider.
        await calculator().load('n = 0 @ slider: 0..10 step 1');
        const [before] = (await calculator().getState()).expressions?.list ?? [];
        assert.equal((before as Expression).slider?.max, undefined);

        const source = await assertRoundTrip(calculator());
        assert.match(source, /n = 0 @ slider: 0\.\. step 1/);
    });

    test('a soft bound is not hardened by the round trip', async () => {
        // Desmos says a bound the slider may be dragged past by leaving the
        // flag off, which is not the same as leaving the bound off.
        await calculator().load('n = 0 @ slider: 0..5 soft max');
        const [before] = (await calculator().getState()).expressions?.list ?? [];
        assert.deepEqual((before as Expression).slider, { hardMin: true, min: '0', max: '5' });

        await assertRoundTrip(calculator());
    });

    test('a clickable switched off stays off, and one switched on still runs', async () => {
        await calculator().load(
            'n = 0\n(0, 0) @ onClick: n -> 99, clickable: false\n(3, 0) @ onClick: n -> n + 1, pointSize: 30',
        );
        const list = (await calculator().getState()).expressions?.list ?? [];
        assert.equal((list[1] as Expression).clickableInfo?.enabled, undefined);

        await assertRoundTrip(calculator());
        assert.equal(await calculator().click({ x: 3, y: 0 }), true);
        assert.equal((await calculator().evaluate('n')).numericValue, 1);
    });

    test('a run of actions still runs all of them', async () => {
        await calculator().load(
            'a = 0\nb = 0\nboth = a -> 1, b -> 2\n(3, 0) @ onClick: both, pointSize: 30',
        );
        await assertRoundTrip(calculator());

        assert.equal(await calculator().click({ x: 3, y: 0 }), true);
        assert.equal((await calculator().evaluate('a')).numericValue, 1);
        assert.equal((await calculator().evaluate('b')).numericValue, 2);
    });

    test('a point style Desmos stashes comes back as the style', async () => {
        await calculator().load('a = 0\nP = (a, 2) @ pointStyle: SQUARE, pointSize: 20');
        const [, point] = (await calculator().getState()).expressions?.list ?? [];
        assert.equal((point as Record<string, unknown>).__stashed_V12PointStyle, 'SQUARE');

        const source = await assertRoundTrip(calculator());
        assert.match(source, /pointStyle: SQUARE/);
    });

    test('a ticker survives, still paced and still playing', async () => {
        await calculator().load('a = 0\nticker a -> a + 1 @ minStep: 200, playing, open');
        const before = (await calculator().getState()).expressions?.ticker;
        assert.deepEqual(before, {
            handlerLatex: 'a\\to a+1',
            minStepLatex: '200',
            playing: true,
            open: true,
        });

        await assertRoundTrip(calculator());
    });

    test('the seed of a graph that draws random numbers draws the same numbers', async () => {
        await calculator().load('r = random()');
        const drawn = (await calculator().evaluate('r')).numericValue;

        const source = await assertRoundTrip(calculator());
        assert.match(source, /randomSeed: "/);
        assert.equal((await calculator().evaluate('r')).numericValue, drawn);
    });

    test('the words Desmos writes as operators survive as themselves', async () => {
        await calculator().load(
            [
                'L = [10, 20, 30]',
                'n = count(L)',
                'm = L.count',
                'i_ndex = 0',
                'P = [(1, 0), (2, 0)] @ onClick: i_ndex -> index, pointSize: 30',
            ].join('\n'),
        );
        await assertRoundTrip(calculator());

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('n')).numericValue, 3);
        assert.equal((await calculator().evaluate('m')).numericValue, 3);
        assert.equal(await calculator().click({ x: 2, y: 0 }), true);
        assert.equal((await calculator().evaluate('i_ndex')).numericValue, 2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A graph written in Desmos rather than in Axis
// ─────────────────────────────────────────────────────────────────────────────
//
// Everything above starts from a file, so everything above starts from latex
// the compiler wrote. A graph somebody built on desmos.com and shared does not:
// its lists are sized brackets, its names carry digits in the middle, its
// widths and opacities are expressions rather than numbers, its sliders
// animate, and its state leaves out whatever Desmos would have assumed. Each of
// those has been a way of losing an expression on the way back in, so the
// states below are written the way desmos.com saves one and applied directly.

/** A 1x1 transparent GIF, the way Desmos stores an image dropped onto a graph. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The options every Axis host applies, which a state saved at desmos.com is
 * applied under too: the expression list open or shut changes the shape of
 * the graphpaper, and so what square axes make of the viewport.
 */
const HOST_OPTIONS = compileAxis('').options;

/** A graph state shaped the way desmos.com saves one. */
const SAVED: ExpressionState[] = [
    { type: 'folder', id: 'f1', title: 'sound', collapsed: true },
    {
        type: 'expression',
        id: 'e1',
        folderId: 'f1',
        color: '#6042a6',
        latex: 'f_{requency}=440',
        // `hardMax` absent: the top is a soft bound.
        slider: {
            hardMin: true,
            loopMode: 'PLAY_INDEFINITELY',
            playDirection: -1,
            min: '110',
            max: '880',
            step: '1',
        },
    },
    {
        type: 'expression',
        id: 'e2',
        folderId: 'f1',
        color: '#6042a6',
        latex: '\\operatorname{tone}\\left(f_{requency},0.2\\right)',
    },
    // A name with a digit in the middle of it, which is not two names.
    {
        type: 'expression',
        id: 'e3',
        folderId: 'f1',
        color: '#2d70b3',
        latex: 'P_{hillL2rand}=\\left[\\left(0,0\\right),\\left(1,1\\right)\\right]',
    },
    // The commas belong to the `with`, not to the folder around it.
    {
        type: 'expression',
        id: 'e4',
        folderId: 'f1',
        color: '#388c46',
        latex: 'g_{ap}=a-b\\operatorname{with}a=2,b=1',
    },
    // The row Desmos keeps: a colour, and no expression at all.
    { type: 'expression', id: 'e5', folderId: 'f1', color: '#c74440' },
    {
        type: 'expression',
        id: 'e6',
        color: '#000000',
        latex: '\\operatorname{polygon}\\left(P_{hillL2rand}\\right)',
        fillOpacity: '\\left[1,0.8\\right]',
        lines: false,
    },
    {
        type: 'expression',
        id: 'e7',
        color: '#c74440',
        latex: '\\left(\\cos t,\\sin t\\right)',
        domain: { min: '0', max: '2\\pi' },
        parametricDomain: { min: '', max: '2\\pi' },
        pointOutline: true,
    },
    // A movable point whose style Desmos stashed, sized only where it moves.
    {
        type: 'expression',
        id: 'e8',
        color: '#fa7e19',
        latex: 'Q=\\left(f_{requency}/100,0\\right)',
        __stashed_V12PointStyle: 'STAR',
        movablePointSize: '20',
    } as Expression,
    // A click switched off, which Desmos says by leaving `enabled` off.
    {
        type: 'expression',
        id: 'e9',
        color: '#2d70b3',
        latex: '\\left(0,-2\\right)',
        clickableInfo: { latex: 'f_{requency}\\to440' },
    },
    {
        type: 'image',
        id: 'e10',
        image_url: PIXEL,
        name: 'pixel',
        center: '\\left(0,1\\right)',
        width: '10\\cdot4.05',
        height: '7.5',
        angle: '-\\frac{\\pi}{200}',
        foreground: true,
        draggable: true,
    },
    { type: 'text', id: 'e11', text: 'A note with "quotes"\nand a second line' },
];

/**
 * The whole saved state: no `doNotMigrateMovablePointStyle`, no random-seed
 * flag - which is the legacy behaviour - and a viewport stash beside the
 * viewport, as desmos.com writes them.
 */
const SAVED_STATE: GraphState = {
    version: 11,
    randomSeed: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    graph: {
        // The harness's graphpaper is 4:3, so square axes keep this as it is.
        viewport: { xmin: -12, ymin: -9, xmax: 12, ymax: 9 },
        showGrid: false,
        __v12ViewportLatexStash: { xmin: '-12', xmax: '12', ymin: '-9', ymax: '9' },
    },
    expressions: { list: SAVED },
};

describe('a graph written in Desmos rather than in Axis', { skip }, () => {
    const calculator = useCalculator();

    test('comes back with every property it had, and then holds still', async () => {
        // The latex does not come back spelt as desmos.com spelt it -
        // `\cos t` is `\cos\left(t\right)` once the compiler has written it -
        // so the first trip is compared by what each item sets, and the test
        // below by what Desmos makes of it. From then on the graph is the
        // compiler's own, and has to come back exactly.
        await calculator().setGraph({ state: SAVED_STATE, options: HOST_OPTIONS });
        const { before } = await reload(calculator());
        const after = await calculator().getState();
        assert.deepEqual(keysOf(comparable(after)), keysOf(comparable(before)));

        await assertRoundTrip(calculator());
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('reads every expression the same way afterwards', async () => {
        // The comparison above is on the state; this is on what Desmos makes
        // of it, which is the question the state is a proxy for. The blank
        // row is not written back, so it is not compared.
        await calculator().setGraph({ state: SAVED_STATE, options: HOST_OPTIONS });
        const drawn = async () =>
            (await calculator().inspectExpressions()).filter(
                expression => expression.type !== 'expression' || expression.latex,
            );
        const before = await drawn();

        await reload(calculator());
        const after = await drawn();

        assert.equal(after.length, before.length);
        for (const [index, expression] of before.entries()) {
            assert.deepEqual(
                after[index].analysis?.evaluation,
                expression.analysis?.evaluation,
                `expression ${index} evaluates differently: ${after[index].latex}`,
            );
            assert.equal(after[index].analysis?.isGraphable, expression.analysis?.isGraphable);
            assert.equal(after[index].analysis?.isError, expression.analysis?.isError);
        }
    });

    test('keeps the legacy random behaviour of a state that never opted out of it', async () => {
        const state: GraphState = {
            version: 11,
            expressions: {
                list: [
                    {
                        type: 'expression',
                        id: '1',
                        latex: 'h\\left(x\\right)=\\operatorname{random}\\left(\\right)',
                    },
                ],
            },
        };
        const { source } = decompileAxis({ state });
        assert.match(source, /includeFunctionParametersInRandomSeed: false/);

        // Under the legacy behaviour every call draws the same number, and
        // Desmos says so by leaving the flag off the state again.
        await calculator().load(source);
        assert.notEqual(
            (await calculator().getState()).includeFunctionParametersInRandomSeed,
            true,
        );
        assert.equal((await calculator().evaluate('h(1) - h(2)')).numericValue, 0);
    });

    test('reports what it cannot write and graphs the rest', async () => {
        await calculator().setGraph({
            state: {
                version: 11,
                graph: { viewport: { xmin: -10, ymin: -10, xmax: 10, ymax: 10 } },
                expressions: {
                    list: [
                        { type: 'expression', id: '1', latex: 'y=x' },
                        { type: 'expression', id: '2', latex: 'y_{1}\\sim mx_{1}+b' },
                        { type: 'expression', id: '3', latex: 'y=2x' },
                    ],
                },
            },
            options: {},
        });
        const { source, diagnostics } = decompileAxis({ state: await calculator().getState() });

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['unsupported-latex'],
        );
        await calculator().load(source);
        const latex = ((await calculator().getState()).expressions?.list ?? []).map(
            item => (item as Expression).latex,
        );
        assert.deepEqual(latex, ['y=x', 'y=2x']);
    });
});
