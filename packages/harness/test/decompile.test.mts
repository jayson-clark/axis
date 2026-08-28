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
 * A property Desmos holds as `undefined` is one it does not have, but whether
 * the key is there at all depends on what it was handed, so those go too.
 */
function comparable(list: ExpressionState[]): Comparable[] {
    const position = new Map(list.map((expression, index) => [expression.id, index]));

    return list.map(expression => {
        const { id, folderId, slider, latex, ...rest } = expression as Expression;
        const playing = slider?.isPlaying === true;

        return set({
            ...rest,
            ...(folderId !== undefined && { folder: position.get(folderId) }),
            ...(slider && { slider: set({ ...slider, ...(playing && { playDirection: 0 }) }) }),
            // A playing slider's value is whatever the animation had reached.
            ...(latex !== undefined && { latex: playing ? latex.split('=')[0] : latex }),
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
    await calculator.load(decompileAxis({ expressions: state.expressions?.list ?? [] }));
    return comparable((await calculator.getState()).expressions?.list ?? []);
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

            const before = comparable((await calculator().getState()).expressions?.list ?? []);
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
