// ═════════════════════════════════════════════════════════════════════════════
// Decompiling what Desmos itself keeps
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler's own suite already pins `compile ∘ decompile ∘ compile`, which
// is the round trip over the graph Axis emitted. This is the other one, and the
// only place it can be run: the graph *Desmos* emitted, which is not the same
// object. It normalises what it is given — a bound that matches its default is
// left off the state, a clickable that is switched off keeps no `enabled` at
// all, and the latex comes back the way Desmos writes it rather than the way
// the compiler did.
//
// So every script here is loaded, read back off the calculator with `getState`,
// decompiled from that, and loaded again: whatever the second graph is missing,
// the decompiler failed to read.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { Expression, ExpressionState, Folder, Note } from '@axis-dsl/desmos';
import { decompileAxis } from '@axis-dsl/compiler';
import { readAxisFile } from '../dist/index.js';
import type { AxisCalculator } from '../dist/index.js';
import { example, exampleDirectory, skip, useCalculator } from './support.mts';

/** An expression as it can be compared between two loads of the same graph. */
type Comparable = Record<string, unknown>;

/**
 * The expression list, with everything that cannot survive a reload taken out.
 *
 * Ids are handed out afresh each time a script is compiled, so a folder is
 * compared by where it sits rather than by what it is called; and a slider that
 * is animating has moved on between one `getState` and the next, so its value
 * and the direction it is travelling in are left out of the comparison. The
 * bounds it is animating between are not — those are the graph.
 *
 * A playing *ticker* moves a graph the same way, except that what it moves is
 * whatever its action names rather than the expression it is attached to — the
 * ticker is not attached to one. Nothing in the state says which definitions it
 * will reach, so when one is running every definition is compared by its name
 * alone. What is being checked either way is that the shape of the graph came
 * back, not that a value nobody is holding still happened to match.
 *
 * A property Desmos holds as `undefined` is one it does not have, but whether
 * the key is there at all depends on what it was handed, so those go too.
 */
function comparable(list: ExpressionState[], ticking = false): Comparable[] {
    const position = new Map(list.map((expression, index) => [expression.id, index]));

    return list.map(expression => {
        const { id, folderId, slider, latex, ...rest } = expression as Expression;
        const moving = slider?.isPlaying === true || ticking;

        return set({
            ...rest,
            ...(folderId !== undefined && { folder: position.get(folderId) }),
            ...(slider && {
                slider: set({ ...slider, ...(slider.isPlaying && { playDirection: 0 }) }),
            }),
            // A moving value is whatever the animation had reached.
            ...(latex !== undefined && { latex: moving ? latex.split('=')[0] : latex }),
        });
    });
}

/** An object with only the properties it actually sets. */
function set<T extends object>(value: T): Comparable {
    return Object.fromEntries(
        Object.entries(value).filter(([, property]) => property !== undefined),
    );
}

/** Load a script, then load what its own graph state decompiles to. */
async function reload(calculator: AxisCalculator): Promise<Comparable[]> {
    const state = await calculator.getState();
    const ticker = state.expressions?.ticker;
    await calculator.load(
        decompileAxis({
            expressions: state.expressions?.list ?? [],
            // The ticker is not in the list, so a decompile handed only the list
            // would drop it — and the graph would come back looking identical
            // and simply never tick.
            ticker,
        }),
    );
    const after = await calculator.getState();
    assert.deepEqual(after.expressions?.ticker, ticker);
    return comparable(after.expressions?.list ?? [], ticker?.playing === true);
}

describe('a graph read back off the calculator', { skip }, () => {
    const calculator = useCalculator();

    const scripts = readdirSync(exampleDirectory()).filter(name => name.endsWith('.axis'));

    for (const name of scripts) {
        test(`${name} decompiles to the same graph`, async () => {
            const script = await readAxisFile(example(name));
            await calculator().load(script.source, {
                path: script.path,
                resolveImport: script.resolveImport,
            });

            const state = await calculator().getState();
            const before = comparable(
                state.expressions?.list ?? [],
                state.expressions?.ticker?.playing === true,
            );
            const after = await reload(calculator());

            assert.deepEqual(await calculator().getErrors(), []);
            assert.deepEqual(after, before);
        });
    }

    test('none of them logged anything to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});

describe('what Desmos leaves out of a graph state', { skip }, () => {
    const calculator = useCalculator();

    test('a bound left off because it is the default comes back', async () => {
        // Desmos drops `max: 10` from the state, since 10 is the max it would
        // have assumed - so an absent bound is the default, not no slider.
        await calculator().load('n = 0 # sliderBounds: {min: 0, max: 10, step: 1}');
        const [before] = (await calculator().getState()).expressions?.list ?? [];
        assert.equal((before as Expression).slider?.max, undefined);

        const [after] = (await reload(calculator())) as [Comparable];
        assert.deepEqual((after as Expression).slider, (before as Expression).slider);
        assert.equal((await calculator().evaluate('n')).numericValue, 0);
    });

    test('a clickable switched off stays off', async () => {
        // A disabled clickable is written by leaving `enabled` off entirely,
        // so reading the absence as "enabled" would switch the action back on.
        await calculator().load('(0, 0) # onClick: n -> 99, clickable: false\nn = 0');
        const [before] = (await calculator().getState()).expressions?.list ?? [];
        assert.equal((before as Expression).clickableInfo?.enabled, undefined);

        const [after] = (await reload(calculator())) as [Comparable];
        assert.deepEqual((after as Expression).clickableInfo, (before as Expression).clickableInfo);
    });

    test('an action that is switched on still runs after the round trip', async () => {
        await calculator().load('n = 0\n(0, 0) # onClick: n -> n + 1, pointSize: 30');
        await reload(calculator());

        assert.equal((await calculator().evaluate('n')).numericValue, 0);
        assert.equal(await calculator().click({ x: 0, y: 0 }), true);
        assert.equal((await calculator().evaluate('n')).numericValue, 1);
    });

    test('a run of actions still runs all of them after the round trip', async () => {
        // Bracketed, Desmos reads the run as a point and runs one coordinate of
        // it - so `a` would come back 0 while `b` came back 2.
        await calculator().load(
            'a = 0\nb = 0\nboth = (a -> 1, b -> 2)\n(3, 0) # onClick: both, pointSize: 30',
        );
        await reload(calculator());

        assert.equal(await calculator().click({ x: 3, y: 0 }), true);
        assert.equal((await calculator().evaluate('a')).numericValue, 1);
        assert.equal((await calculator().evaluate('b')).numericValue, 2);
    });

    test('a soft slider bound is not hardened by the round trip', async () => {
        // Desmos says a bound the slider may be dragged past by leaving the
        // flag off, which is not the same as leaving the bound off.
        await calculator().load('n = 0 # sliderBounds: {min: 0, max: 5, hardMax: false}');
        const [before] = (await calculator().getState()).expressions?.list ?? [];
        assert.deepEqual((before as Expression).slider, { hardMin: true, max: '5', min: '0' });

        const [after] = (await reload(calculator())) as [Comparable];
        assert.deepEqual((after as Expression).slider, (before as Expression).slider);
    });

    test('a ticker survives the round trip, still paced and still playing', async () => {
        await calculator().load(
            'a = 0\nticker a -> a + 1 # minStep: 200, playing: true, open: true',
        );
        const before = (await calculator().getState()).expressions?.ticker;
        assert.deepEqual(before, {
            handlerLatex: 'a\\to a+1',
            minStepLatex: '200',
            playing: true,
            open: true,
        });

        await reload(calculator());
        assert.deepEqual((await calculator().getState()).expressions?.ticker, before);
    });

    test('the words Desmos writes as operators survive as themselves', async () => {
        // `count` and `index` compile to `c_{ount}` and `i_{ndex}` if the
        // language does not know them - undefined variables Desmos accepts in
        // silence - and a variable actually called `index` has to stay one.
        await calculator().load(
            [
                'L = [10, 20, 30]',
                'n = count(L)',
                'm = L.count',
                'i_ndex = 0',
                'P = [(1, 0), (2, 0)] # onClick: i_ndex -> index, pointSize: 30',
            ].join('\n'),
        );
        await reload(calculator());

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('n')).numericValue, 3);
        assert.equal((await calculator().evaluate('m')).numericValue, 3);

        assert.equal(await calculator().click({ x: 2, y: 0 }), true);
        assert.equal((await calculator().evaluate('i_ndex')).numericValue, 2);
    });
});

describe('the graph the decompiled source builds', { skip }, () => {
    const calculator = useCalculator();

    test('still defines and evaluates the same functions', async () => {
        await calculator().load('f(x) = 2x + 1\ng(x) = f(x) + x / 2\ny = g(x)');
        await reload(calculator());

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('f(20)')).numericValue, 41);
        assert.equal((await calculator().evaluate('g(20)')).numericValue, 51);
    });

    test('keeps every name Desmos wrote as a subscript', async () => {
        await calculator().load('amplitude = 3\nperiod = 2\ny = amplitude * sin(period * x)');
        await reload(calculator());

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('amplitude')).numericValue, 3);
        assert.equal((await calculator().evaluate('period')).numericValue, 2);
    });

    test('keeps a folder, its title and what is inside it', async () => {
        await calculator().load('folder "Curves" { # collapsed: true\n"A note",\ny = x\n}\ny = 2x');
        await reload(calculator());
        const list = (await calculator().getState()).expressions?.list ?? [];
        const [folder, note, inside, outside] = list as [Folder, Note, Expression, Expression];

        assert.equal(folder.title, 'Curves');
        assert.equal(folder.collapsed, true);
        assert.equal(note.text, 'A note');
        assert.equal(inside.folderId, folder.id);
        assert.equal(outside.folderId, undefined);
    });

    test('keeps a table and the columns under it', async () => {
        await calculator().load('table {\nx = [1, 2, 3],\ny = [2, 4, 8]\n}');
        await reload(calculator());
        const [table] = (await calculator().getState()).expressions?.list ?? [];

        assert.equal(table.type, 'table');
        assert.deepEqual(
            (table as { columns: { values?: string[] }[] }).columns.map(column => column.values),
            [
                ['1', '2', '3'],
                ['2', '4', '8'],
            ],
        );
    });

    test('reads a bare run of points as the very same list', async () => {
        // The decompiler writes such a run as `[(1, 2), (3, 4)]`, which is only
        // right because Desmos means nothing else by it. That is a fact about
        // Desmos rather than about the compiler, so it is pinned here: if the
        // two forms ever stop agreeing, the decompiler is wrong to merge them.
        await calculator().setExpressions([
            { type: 'expression', id: '1', latex: 'A=\\left(1,2\\right),\\left(3,4\\right)' },
            {
                type: 'expression',
                id: '2',
                latex: 'B=\\left[\\left(1,2\\right),\\left(3,4\\right)\\right]',
            },
        ]);

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal(
            (await calculator().evaluateLatex('\\operatorname{length}\\left(A\\right)'))
                .numericValue,
            2,
        );
        // Element for element, both coordinates, so nothing hides in the sum.
        for (const coordinate of ['x', 'y']) {
            assert.equal(
                (
                    await calculator().evaluateLatex(
                        `\\operatorname{total}\\left(A.${coordinate}-B.${coordinate}\\right)`,
                    )
                ).numericValue,
                0,
            );
        }
    });

    test('is a graph Desmos still shades', async () => {
        // An inequality Desmos will not shade is the sort of thing that only
        // shows up here: it compiles either way.
        await calculator().load('x^2 + y^2 <= 9 # color: #2d70b3, fillOpacity: 0.4');
        await reload(calculator());
        const [inequality] = await calculator().inspectExpressions();

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal(inequality.analysis?.isGraphable, true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A graph written in Desmos rather than in Axis
// ─────────────────────────────────────────────────────────────────────────────
//
// Everything above starts from a script, so everything above starts from latex
// the compiler wrote. A graph somebody built on desmos.com and shared does not:
// its lists are sized brackets, its names carry digits in the middle, its
// widths and opacities are expressions rather than numbers, and its sliders
// animate. Each of those has been a way of losing an expression on the way back
// in, so the state below is written the way Desmos writes one and applied
// directly.

/** A 1x1 transparent GIF, the way Desmos stores an image dropped onto a graph. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** A graph state shaped the way desmos.com writes one. */
const DESMOS_STATE: ExpressionState[] = [
    { type: 'folder', id: 'f1', title: 'sound', collapsed: true },
    {
        type: 'expression',
        id: 'e1',
        folderId: 'f1',
        color: '#6042a6',
        latex: 'f_{requency}=440',
        slider: {
            hardMin: true,
            hardMax: true,
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
    // Desmos keeps the row Desmos keeps: a colour, and no expression at all.
    { type: 'expression', id: 'e5', folderId: 'f1', color: '#c74440' },
    {
        type: 'expression',
        id: 'e6',
        color: '#000000',
        latex: '\\operatorname{polygon}\\left(P_{hillL2rand}\\right)',
        // Latex rather than a number, which is what makes it worth pinning:
        // written back as raw text this comes out as a carriage return.
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
    {
        type: 'image',
        id: 'e8',
        image_url: PIXEL,
        name: 'pixel',
        center: '\\left(0,1\\right)',
        width: '10\\cdot4.05',
        height: '7.5',
        angle: '-\\frac{\\pi}{200}',
        foreground: true,
    },
];

describe('a graph written in Desmos rather than in Axis', { skip }, () => {
    const calculator = useCalculator();

    test('comes back as the same graph, expression for expression', async () => {
        await calculator().setExpressions(DESMOS_STATE);
        const state = await calculator().getState();
        const before = comparable(state.expressions?.list ?? []);

        const after = await reload(calculator());

        assert.deepEqual(await calculator().getErrors(), []);
        assert.deepEqual(after, before);
    });

    test('reads every expression the same way afterwards', async () => {
        // The comparison above is on the state; this is on what Desmos makes of
        // it, which is the question the state is a proxy for.
        await calculator().setExpressions(DESMOS_STATE);
        const before = await calculator().inspectExpressions();

        await reload(calculator());
        const after = await calculator().inspectExpressions();

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

    test('still plays the tone the graph was built to play', async () => {
        // `tone` is a function, not the variable `t_{one}` an unknown name
        // compiles to - which Desmos accepts in silence and never evaluates.
        await calculator().setExpressions(DESMOS_STATE);
        await reload(calculator());
        const played = (await calculator().inspectExpressions()).find(expression =>
            expression.latex?.includes('tone'),
        );

        assert.ok(played, 'the tone is not in the graph at all');
        assert.equal(played.analysis?.isError, false);
    });
});
