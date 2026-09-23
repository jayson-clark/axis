// ═════════════════════════════════════════════════════════════════════════════
// The shape of the graph a file builds
// ═════════════════════════════════════════════════════════════════════════════
//
// Folders, tables, notes, imports and images are structure rather than maths,
// and structure is the part `getState` reports on: what ended up in which
// folder, which columns a table has, what an import brought with it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { Expression, Folder, GraphImage, Note, Table } from '@axis-dsl/desmos';
import { compileAxis, type CompileOptions } from '@axis-dsl/compiler';
import { readAxisFile, type AxisCalculator } from '../dist/index.js';
import { example, exampleDirectory, skip, useCalculator } from './support.mts';

/** The codes of a compilation's diagnostics, which is what most tests here assert. */
const codes = (source: string, options?: CompileOptions) =>
    compileAxis(source, options).diagnostics.map(diagnostic => diagnostic.code);

/** Load source that has to be clean, and hand back the applied list. */
async function loadClean(calculator: AxisCalculator, source: string, options?: CompileOptions) {
    const { diagnostics } = await calculator.load(source, options);
    assert.deepEqual(
        diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`),
        [],
        `${source} is not clean`,
    );
    return (await calculator.getState()).expressions?.list ?? [];
}

/** Load one of the example files, imports and images resolved from disk. */
async function loadExample(calculator: AxisCalculator, name: string) {
    const file = await readAxisFile(example(name));
    return calculator.load(file.source, {
        path: file.path,
        resolveImport: file.resolveImport,
        resolveImage: file.resolveImage,
    });
}

describe('separators', { skip }, () => {
    const calculator = useCalculator();

    test('`;` ends a statement the way a newline does', async () => {
        assert.deepEqual(
            compileAxis('a = 1; b = 2; y = a * x + b').state,
            compileAxis('a = 1\nb = 2\ny = a * x + b').state,
        );

        await loadClean(calculator(), 'a = 1; b = 2; y = a * x + b');
        assert.equal((await calculator().evaluate('a + b')).numericValue, 3);
    });

    test('and inside every block', async () => {
        assert.deepEqual(
            compileAxis('folder "F" { y = x; y = 2x }\ntable { x = [1, 2]; y = [3, 4] }').state,
            compileAxis(
                'folder "F" {\n    y = x\n    y = 2x\n}\ntable {\n    x = [1, 2]\n    y = [3, 4]\n}',
            ).state,
        );

        const list = await loadClean(
            calculator(),
            'folder "F" { y = x; y = 2x }\ntable { x = [1, 2]; y = [3, 4] }',
        );
        const [folder, first, second, table] = list as [Folder, Expression, Expression, Table];

        assert.equal(first.folderId, folder.id);
        assert.equal(second.folderId, folder.id);
        assert.equal(table.columns.length, 2);
    });

    test('blank statements are nothing', async () => {
        const list = await loadClean(calculator(), ';;a = 1;;\n\n;b = 2;');

        assert.equal(list.length, 2);
    });

    test('a statement spread over brackets is still one', async () => {
        const list = await loadClean(calculator(), 'L = [\n    1,\n    2,\n    3,\n]\nM = L * 2');

        assert.equal(list.length, 2);
        assert.deepEqual((await calculator().evaluate('M')).listValue, [2, 4, 6]);
    });
});

describe('folders', { skip }, () => {
    const calculator = useCalculator();

    test('everything written inside one is in it', async () => {
        const list = await loadClean(
            calculator(),
            'folder "Curves" {\n    y = x\n    y = 2x\n}\ny = 3x',
        );
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

    test('an untitled folder is one Desmos stores with no title', async () => {
        const [folder, curve] = await loadClean(calculator(), 'folder { y = x }');

        assert.equal(folder.type, 'folder');
        assert.equal('title' in folder, false);
        assert.equal((curve as Expression).folderId, folder.id);
    });

    test('a note inside a folder is an entry like any other', async () => {
        const [folder, note] = await loadClean(
            calculator(),
            'folder "F" {\n    "A note"\n    y = x\n}',
        );

        assert.equal((note as Note).type, 'text');
        assert.equal((note as Note).text, 'A note');
        assert.equal((note as Note).folderId, (folder as Folder).id);
    });

    test('a table inside a folder joins it too', async () => {
        const [folder, table] = await loadClean(
            calculator(),
            'folder "F" {\n    table { x = [1, 2]; y = [3, 4] }\n}',
        );

        assert.equal((table as Table).type, 'table');
        assert.equal((table as Table).folderId, (folder as Folder).id);
    });

    test('its metadata is written on the line of its brace, inline or as a block', async () => {
        const inline = await loadClean(
            calculator(),
            'folder "W" { @ collapsed, hidden\n    y = x\n}',
        );
        const block = await loadClean(
            calculator(),
            'folder "W" { @{\n    collapsed\n    hidden\n}\n    y = x\n}',
        );

        for (const [folder] of [inline, block]) {
            assert.equal((folder as Folder).collapsed, true);
            assert.equal((folder as Folder).hidden, true);
        }
    });

    test('a folder inside a folder is an error, and its contents join the outer one', async () => {
        // Desmos has one level of folders, so there is nowhere for a second to
        // go: it is reported, and what it held lands in the folder it is in.
        const source =
            'folder "Outer" {\n    y = x\n    folder "Inner" {\n        y = 2x\n    }\n}';
        const { diagnostics } = await calculator().load(source);
        const list = (await calculator().getState()).expressions?.list ?? [];
        const folders = list.filter(item => item.type === 'folder') as Folder[];

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['nested-folder'],
        );
        assert.deepEqual(
            folders.map(folder => folder.title),
            ['Outer'],
        );
        assert.ok(
            list
                .filter(item => item.type === 'expression' && (item as Expression).latex)
                .every(item => (item as Expression).folderId === folders[0].id),
        );
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a collapsed folder still holds a working graph', async () => {
        await loadClean(calculator(), 'folder "F" { @ collapsed\n    f(x) = 2x\n    y = f(x)\n}');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('f(4)')).numericValue, 8);
    });
});

describe('tables', { skip }, () => {
    const calculator = useCalculator();

    test('columns and their values reach the calculator', async () => {
        const [table] = await loadClean(
            calculator(),
            'table {\n    x = [1, 2, 3]\n    y = [1, 4, 9]\n}',
        );
        const columns = (table as Table).columns;

        assert.equal((table as Table).type, 'table');
        assert.equal(columns.length, 2);
        assert.equal(columns[0].latex, 'x');
        assert.deepEqual(columns[0].values, ['1', '2', '3']);
        assert.deepEqual(columns[1].values, ['1', '4', '9']);
    });

    test('a column is styled on its own', async () => {
        const [table] = await loadClean(
            calculator(),
            'table {\n    x = [1, 2]\n    y = [3, 4] @ color: #ff0000, points: false, lines\n}',
        );
        const [, styled] = (table as Table).columns;

        assert.equal(styled.color, '#ff0000');
        assert.equal(styled.points, false);
        assert.equal(styled.lines, true);
    });

    test("a table's metadata is every column's default, and a column's own wins", async () => {
        const [table] = await loadClean(
            calculator(),
            'table { @ color: #00aa00, lines, lineStyle: DASHED\n' +
                '    x = [1, 2]\n' +
                '    y = [3, 4]\n' +
                '    z = [5, 6] @ color: #aa0000, lines: false\n' +
                '}',
        );
        const [, y, z] = (table as Table).columns;

        assert.equal(y.color, '#00aa00');
        assert.equal(y.lines, true);
        assert.equal(y.lineStyle, 'DASHED');
        assert.equal(z.color, '#aa0000');
        // A column's lines are off by default, so Desmos writes `false` by
        // leaving it off - which is still the column's own word winning.
        assert.notEqual(z.lines, true);
        assert.equal(z.lineStyle, 'DASHED', 'what the column does not say, the table does');
    });

    test('a column with no values is computed from the one before it', async () => {
        const [table] = await loadClean(
            calculator(),
            'table {\n    u = [-3, -2, -1, 0, 1, 2, 3]\n    u ^ 2\n}',
        );

        assert.deepEqual(await calculator().getErrors(), []);
        const [values, computed] = (table as Table).columns;

        assert.deepEqual(values.values, ['-3', '-2', '-1', '0', '1', '2', '3']);
        assert.equal(computed.latex, 'u^{2}');
        // Desmos computes the column rather than storing it, so the state
        // carries the expression and no values of its own.
        assert.equal(computed.values, undefined);
    });

    test('a column that is an equation is an error', () => {
        // Only `header = [values]` splits into a header and values; `x = 5`
        // is neither that nor anything a column can compute (spec §3.2).
        assert.deepEqual(codes('table { x = 5 }'), ['invalid-column']);
    });

    test('a column named in a table is a variable the rest of the graph reads', async () => {
        await loadClean(calculator(), 'table { u = [1, 2, 3]; v = [4, 5, 6] }\na = total(v)');

        assert.equal((await calculator().evaluate('a')).numericValue, 15);
    });
});

describe('notes', { skip }, () => {
    const calculator = useCalculator();

    test('a bare string is a note, and Desmos keeps its text', async () => {
        const [note] = await loadClean(calculator(), '"Getting started"\ny = x');

        assert.equal((note as Note).type, 'text');
        assert.equal((note as Note).text, 'Getting started');
    });

    test('its escapes are the characters they stand for', async () => {
        const [note] = await loadClean(calculator(), '"a \\"quoted\\" word\\nand a line"');

        assert.equal((note as Note).text, 'a "quoted" word\nand a line');
    });

    test('a note is not analyzed as maths', async () => {
        await loadClean(calculator(), '"y = this is not an equation"');

        assert.deepEqual(await calculator().getErrors(), []);
    });
});

describe('imports', { skip }, () => {
    const calculator = useCalculator();

    /** A host with a few files in it, for the imports written inline below. */
    const FILES: Record<string, string> = {
        '/lib.axis': 'y = 2x\nk = 3',
        '/nested.axis': 'folder "Inside" { m = 4 }\nimport "lib"',
        '/configured.axis': 'config { showGrid: false; degreeMode: true }\nz = 1',
        '/a.axis': 'import "b"\na = 1',
        '/b.axis': 'import "a"\nb = 1',
    };
    const host: CompileOptions = {
        path: '/graph.axis',
        resolveImport: specifier => {
            const path = `/${specifier.replace(/^\.?\//, '').replace(/\.axis$/, '')}.axis`;
            return FILES[path] === undefined ? undefined : { path, source: FILES[path] };
        },
    };

    test('an imported file arrives as one folder, named for the import', async () => {
        const { diagnostics } = await loadExample(calculator(), '16-imports.axis');
        const list = (await calculator().getState()).expressions?.list ?? [];
        const folders = list.filter(item => item.type === 'folder') as Folder[];

        assert.deepEqual(diagnostics, []);
        assert.ok(
            folders.some(folder => folder.title === 'Waves'),
            `expected a folder named by the import, got ${folders.map(f => f.title).join(', ')}`,
        );
    });

    test('what an import brought is in scope for the rest of the file', async () => {
        await loadExample(calculator(), '16-imports.axis');

        // `sine` and `envelope` are defined in the imported files, and the
        // entry file graphs their product.
        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('sine(0)')).numericValue, 0);
    });

    test('an import is titled by its file, or by `as`, and starts collapsed', async () => {
        const plain = await loadClean(calculator(), 'import "lib"', host);
        const titled = await loadClean(calculator(), 'import "lib" as "Library"', host);

        assert.equal((plain[0] as Folder).title, 'lib');
        assert.equal((plain[0] as Folder).collapsed, true);
        assert.equal((titled[0] as Folder).title, 'Library');
        assert.equal((await calculator().evaluate('k')).numericValue, 3);
    });

    test("an imported file's folders are flattened into the import's", async () => {
        const list = await loadClean(calculator(), 'import "nested"', host);
        const folders = list.filter(item => item.type === 'folder') as Folder[];

        assert.equal(folders.length, 1);
        assert.ok(
            list
                .filter(item => item.type !== 'folder')
                .every(item => (item as Expression).folderId === folders[0].id),
        );
        assert.equal((await calculator().evaluate('m + k')).numericValue, 7);
    });

    test('an import inside a folder joins that folder rather than opening one', async () => {
        const list = await loadClean(calculator(), 'folder "Host" {\n    import "lib"\n}', host);
        const folders = list.filter(item => item.type === 'folder') as Folder[];

        assert.equal(folders.length, 1);
        assert.equal(folders[0].title, 'Host');
        assert.equal((await calculator().evaluate('k')).numericValue, 3);
    });

    test('a file imported twice is included once', async () => {
        // A second copy would define every name in it again, which Desmos
        // rejects - so the second import is nothing.
        await loadClean(calculator(), 'import "lib"\nimport "lib"', host);

        assert.deepEqual(await calculator().getErrors(), []);
    });

    test("an imported config applies, under the file's own", async () => {
        await loadClean(calculator(), 'config { showGrid: true }\nimport "configured"', host);
        const settings = await calculator().getSettings();

        assert.equal(settings.showGrid, true, 'the entry file has to win');
        assert.equal(settings.degreeMode, true, 'and the import still contributes');
    });

    test('a missing import is an error, and the rest of the file still graphs', async () => {
        const { diagnostics } = await calculator().load('import "nowhere"\na = 5', host);

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['unresolved-import'],
        );
        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('a')).numericValue, 5);
    });

    test('an import cycle is an error against the import that closes it', async () => {
        const { diagnostics } = await calculator().load('import "a"', host);

        assert.deepEqual(
            diagnostics.map(diagnostic => [diagnostic.code, diagnostic.path]),
            [['import-cycle', '/b.axis']],
        );
        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('a + b')).numericValue, 2);
    });
});

describe('images', { skip }, () => {
    const calculator = useCalculator();

    /** The picture `18-images.axis` draws, as it sits on disk. */
    const picture = () => readFileSync(example('images/wave.png'));

    test('a file beside the one importing it arrives in the graph as a data URI', async () => {
        await loadExample(calculator(), '18-images.axis');

        const list = (await calculator().getState()).expressions?.list ?? [];
        const images = list.filter(item => item.type === 'image') as GraphImage[];

        assert.equal(images.length, 2);
        assert.deepEqual(await calculator().getErrors(), []);
        for (const image of images) {
            // Byte for byte the file, which is the whole point of inlining it:
            // a path would have reached Desmos as a URL nothing can fetch.
            assert.equal(image.image_url, `data:image/png;base64,${picture().toString('base64')}`);
        }
    });

    test('the placement Desmos keeps is the expression the file wrote', async () => {
        await loadExample(calculator(), '18-images.axis');

        const list = (await calculator().getState()).expressions?.list ?? [];
        const [placed] = list.filter(item => item.type === 'image') as GraphImage[];

        assert.equal(placed.name, 'Wave');
        assert.equal(placed.center, 'c');
        assert.equal(placed.width, 'w');
        assert.equal(placed.height, 'w\\cdot0.6');
    });

    test('a picture that cannot be read is an error, and the rest still graphs', async () => {
        const { diagnostics } = await calculator().load('image "./missing.png"\na = 5', {
            path: '/graph.axis',
            resolveImage: () => undefined,
        });

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['unresolved-image'],
        );
        assert.equal((await calculator().evaluate('a')).numericValue, 5);
    });

    test('a path that is not a picture is an error of its own', () => {
        assert.deepEqual(codes('image "./notes.txt"'), ['invalid-image']);
    });
});

describe('the example files', { skip }, () => {
    const calculator = useCalculator();

    // The tour in examples/ is what a newcomer reads first, and it is also the
    // widest use of the language there is - every one of them has to be a
    // file the checker has nothing to say about, and a graph Desmos accepts
    // outright.
    const files = readdirSync(exampleDirectory()).filter(name => name.endsWith('.axis'));

    test('there are examples to check', () => {
        assert.ok(files.length >= 20, `only found ${files.length}`);
    });

    for (const name of files) {
        test(`${name} compiles cleanly and produces a graph with no errors`, async () => {
            const { diagnostics } = await loadExample(calculator(), name);

            assert.deepEqual(
                diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`),
                [],
            );
            assert.deepEqual(await calculator().getErrors(), []);
        });
    }

    test('none of them logged anything to the console', () => {
        assert.deepEqual(calculator().consoleErrors(), []);
    });
});

describe('the graph as a whole', { skip }, () => {
    const calculator = useCalculator();

    test('every item gets an id Desmos keeps', async () => {
        const source = 'y = x\nfolder "F" {\n    y = 2x\n}\ntable { x = [1]; y = [2] }\n"note"';
        const compiled = compileAxis(source).state.expressions?.list ?? [];
        const list = await loadClean(calculator(), source);

        const compiledIds = compiled.map(item => item.id);
        assert.equal(new Set(compiledIds).size, compiledIds.length, 'ids must be distinct');
        for (const id of compiledIds) {
            assert.ok(
                list.some(item => item.id === id),
                `${id} did not survive into the graph`,
            );
        }
    });

    test('an empty file is an empty graph, not an error', async () => {
        await loadClean(calculator(), '// nothing but a comment\n');

        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a file reloaded twice ends up the same both times', async () => {
        const source = 'a = 5 @ slider: 1..9\ny = a * x @ color: #ff0000';

        await calculator().load(source);
        const first = (await calculator().getState()).expressions;
        await calculator().reset();
        await calculator().load(source);
        const second = (await calculator().getState()).expressions;

        assert.deepEqual(second, first);
    });

    test('the viewport is the one the file gave, the rest filled in', async () => {
        await loadClean(calculator(), 'config { xmin: -2; squareAxes: false }\ny = x');
        const viewport = (await calculator().getState()).graph?.viewport;

        assert.deepEqual(viewport, { xmin: -2, xmax: 10, ymin: -10, ymax: 10 });
    });
});
