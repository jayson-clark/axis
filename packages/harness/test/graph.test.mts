// ═════════════════════════════════════════════════════════════════════════════
// The shape of the graph a script builds
// ═════════════════════════════════════════════════════════════════════════════
//
// Folders, tables, notes and imports are structure rather than maths, and
// structure is the part `getState` reports on: what ended up in which folder,
// which columns a table has, what an import brought with it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import type { Expression, Folder, Note, Table } from '@axis-dsl/desmos';
import { compileAxis } from '@axis-dsl/compiler';
import { readAxisFile } from '../dist/index.js';
import { example, exampleDirectory, skip, useCalculator } from './support.mts';

describe('separators', { skip }, () => {
    const calculator = useCalculator();

    test('a block written without its commas builds the same graph', async () => {
        await calculator().load(
            'folder "Curves" {\ny = x\ny = 2x\n}\ntable {\nx = [1, 2]\ny = [3, 4]\n}',
        );
        const list = (await calculator().getState()).expressions?.list ?? [];
        const [folder, first, second, table] = list as [Folder, Expression, Expression, Table];

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal(first.folderId, folder.id);
        assert.equal(second.folderId, folder.id);
        assert.equal(table.type, 'table');
        assert.equal(table.columns?.length, 2);
    });
});

describe('a metadata block', { skip }, () => {
    const calculator = useCalculator();

    test('reaches the graph the way a trailing run does', async () => {
        await calculator().load(
            'y = sin(x) #{\n    color: #c74440\n    lineStyle: DASHED\n    label: "a wave"\n}',
        );
        const [expression] = (await calculator().getState()).expressions?.list ?? [];

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((expression as Expression).color, '#c74440');
        assert.equal((expression as Expression).lineStyle, 'DASHED');
        assert.equal((expression as Expression).label, 'a wave');
    });

    test('builds a slider Desmos accepts, bounds and all', async () => {
        // A slider is the property most easily dropped on the floor by
        // setState, and the one most worth writing over several lines.
        await calculator().load(
            'a = 1 #{\n    sliderBounds: {min: 0, max: 5, step: 0.5}\n    playing: false\n}\ny = a * x',
        );
        const [slider] = (await calculator().getState()).expressions?.list ?? [];

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((slider as Expression).slider?.min, '0');
        assert.equal((slider as Expression).slider?.max, '5');
        assert.equal((await calculator().evaluate('a')).numericValue, 1);
    });

    test('starts a folder collapsed from inside its brace', async () => {
        await calculator().load('folder "Working" { #{\n    collapsed: true\n}\n    y = x\n}');
        const [folder] = (await calculator().getState()).expressions?.list ?? [];

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((folder as Folder).title, 'Working');
        assert.equal((folder as Folder).collapsed, true);
    });
});

describe('folders', { skip }, () => {
    const calculator = useCalculator();

    test('everything written inside one is in it', async () => {
        await calculator().load('folder "Curves" {\ny = x,\ny = 2x\n}\ny = 3x');
        const list = (await calculator().getState()).expressions?.list ?? [];
        const [folder, first, second, outside] = list as [
            Folder,
            Expression,
            Expression,
            Expression,
        ];

        assert.equal(folder.type, 'folder');
        assert.equal(folder.title, 'Curves');
        assert.equal(first.folderId, folder.id);
        assert.equal(second.folderId, folder.id);
        assert.equal(outside.folderId, undefined);
    });

    test('a note inside a folder is an entry like any other', async () => {
        await calculator().load('folder "F" {\n"A note",\ny = x\n}');
        const [folder, note] = (await calculator().getState()).expressions?.list ?? [];

        assert.equal((note as Note).type, 'text');
        assert.equal((note as Note).text, 'A note');
        assert.equal((note as Note).folderId, (folder as Folder).id);
    });

    test('a table inside a folder joins it too', async () => {
        await calculator().load('folder "F" {\ntable { x = [1, 2], y = [3, 4] }\n}');
        const [folder, table] = (await calculator().getState()).expressions?.list ?? [];

        assert.equal((table as Table).type, 'table');
        assert.equal((table as Table).folderId, (folder as Folder).id);
    });

    test('a folder written inside a folder becomes a sibling of it', async () => {
        // Desmos has one level of folders, so there is nowhere for a second to
        // go: the inner one opens beside the outer, and takes the contents.
        await calculator().load('folder "Outer" {\ny = x\n}\nfolder "Inner" {\ny = 2x\n}');
        const list = (await calculator().getState()).expressions?.list ?? [];
        const folders = list.filter(expression => expression.type === 'folder') as Folder[];

        assert.deepEqual(
            folders.map(folder => folder.title),
            ['Outer', 'Inner'],
        );
        assert.equal(
            folders.every(folder => !('folderId' in folder && folder.folderId)),
            true,
        );
    });

    test('a collapsed folder still holds a working graph', async () => {
        await calculator().load('folder "F" { # collapsed: true\nf(x) = 2x,\ny = f(x)\n}');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('f(4)')).numericValue, 8);
    });
});

describe('tables', { skip }, () => {
    const calculator = useCalculator();

    test('columns and their values reach the calculator', async () => {
        await calculator().load('table {\nx = [1, 2, 3],\ny = [1, 4, 9]\n}');
        const [table] = (await calculator().getState()).expressions?.list ?? [];
        const columns = (table as Table).columns;

        assert.equal((table as Table).type, 'table');
        assert.equal(columns.length, 2);
        assert.equal(columns[0].latex, 'x');
        assert.deepEqual(columns[0].values, ['1', '2', '3']);
        assert.deepEqual(columns[1].values, ['1', '4', '9']);
    });

    test('a column is styled on its own', async () => {
        await calculator().load(
            'table {\nx = [1, 2],\ny = [3, 4] # color: #ff0000, points: false, lines: true\n}',
        );
        const [table] = (await calculator().getState()).expressions?.list ?? [];
        const [, styled] = (table as Table).columns;

        assert.equal(styled.color, '#ff0000');
        assert.equal(styled.points, false);
        assert.equal(styled.lines, true);
    });

    test('a column with no values is computed from the one before it', async () => {
        // Written as the bare expression, not as `y = u^2`: a column is either
        // a name with a list of values or an expression standing on its own.
        await calculator().load('table {\nu = [-3, -2, -1, 0, 1, 2, 3],\nu ^ 2\n}');

        assert.deepEqual(await calculator().getErrors(), []);
        const [table] = (await calculator().getState()).expressions?.list ?? [];
        const [values, computed] = (table as Table).columns;

        assert.deepEqual(values.values, ['-3', '-2', '-1', '0', '1', '2', '3']);
        assert.equal(computed.latex, 'u^2');
        // Desmos computes the column rather than storing it, so the state
        // carries the expression and no values of its own.
        assert.equal(computed.values, undefined);
    });
});

describe('notes', { skip }, () => {
    const calculator = useCalculator();

    test('a bare string is a note, and Desmos keeps its text', async () => {
        await calculator().load('"Getting started"\ny = x');
        const [note] = (await calculator().getState()).expressions?.list ?? [];

        assert.equal((note as Note).type, 'text');
        assert.equal((note as Note).text, 'Getting started');
    });

    test('a note is not analyzed as maths', async () => {
        await calculator().load('"y = this is not an equation"');

        assert.deepEqual(await calculator().getErrors(), []);
    });
});

describe('imports', { skip }, () => {
    const calculator = useCalculator();

    test('an imported file arrives as one folder', async () => {
        const script = await readAxisFile(example('16-imports.axis'));
        await calculator().load(script.source, {
            path: script.path,
            resolveImport: script.resolveImport,
        });
        const list = (await calculator().getState()).expressions?.list ?? [];
        const folders = list.filter(expression => expression.type === 'folder') as Folder[];

        assert.ok(
            folders.some(folder => folder.title === 'Waves'),
            `expected a folder named by the import, got ${folders.map(f => f.title).join(', ')}`,
        );
    });

    test('what an import brought is in scope for the rest of the script', async () => {
        const script = await readAxisFile(example('16-imports.axis'));
        await calculator().load(script.source, {
            path: script.path,
            resolveImport: script.resolveImport,
        });

        // `sine` and `envelope` are defined in the two imported files, and the
        // entry script graphs their product.
        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('sine(0)')).numericValue, 0);
    });

    test('an import inside a folder joins that folder rather than opening one', async () => {
        const source = 'folder "Host" {\nimport "lib"\n}';
        const expressions = compileAxis(source, {
            path: '/graph.axis',
            resolveImport: () => ({ path: '/lib.axis', source: 'y = x' }),
        }).expressions;
        const folders = expressions.filter(expression => expression.type === 'folder') as Folder[];

        assert.equal(folders.length, 1);
        assert.equal(folders[0].title, 'Host');
    });

    test('a missing import is an error rather than a silently smaller graph', () => {
        assert.throws(
            () =>
                compileAxis('import "nowhere"', {
                    path: '/graph.axis',
                    resolveImport: () => undefined,
                }),
            /nowhere/,
        );
    });
});

describe('the example scripts', { skip }, () => {
    const calculator = useCalculator();

    // The tour in examples/ is what a newcomer reads first, and it is also the
    // widest use of the language there is — every one of them has to be a graph
    // Desmos accepts outright.
    const scripts = readdirSync(exampleDirectory()).filter(name => name.endsWith('.axis'));

    test('there are examples to check', () => {
        assert.ok(scripts.length >= 20, `only found ${scripts.length}`);
    });

    for (const name of scripts) {
        test(`${name} produces a graph with no errors`, async () => {
            const script = await readAxisFile(example(name));
            await calculator().load(script.source, {
                path: script.path,
                resolveImport: script.resolveImport,
            });

            assert.deepEqual(await calculator().getErrors(), []);
        });
    }

    test('none of them logged anything to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});

describe('the graph as a whole', { skip }, () => {
    const calculator = useCalculator();

    test('every expression gets an id Desmos keeps', async () => {
        const source = 'y = x\nfolder "F" {\ny = 2x\n}\ntable { x = [1], y = [2] }\n"note"';
        const compiled = compileAxis(source).expressions;
        await calculator().load(source);
        const list = (await calculator().getState()).expressions?.list ?? [];

        const compiledIds = compiled.map(expression => expression.id);
        assert.equal(new Set(compiledIds).size, compiledIds.length, 'ids must be distinct');
        for (const id of compiledIds) {
            assert.ok(
                list.some(expression => expression.id === id),
                `${id} did not survive into the graph`,
            );
        }
    });

    test('an empty script is an empty graph, not an error', async () => {
        await calculator().load('// nothing but a comment\n');

        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a script reloaded twice ends up the same both times', async () => {
        const source = 'a = 5 # sliderBounds: {min: 1, max: 9}\ny = a * x # color: #ff0000';

        await calculator().load(source);
        const first = (await calculator().getState()).expressions;
        await calculator().reset();
        await calculator().load(source);
        const second = (await calculator().getState()).expressions;

        assert.deepEqual(second, first);
    });
});
