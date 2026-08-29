import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileAxis, createImportResolver, findImports, loadImports } from '../dist/index.js';
import type { DesmosExpression, Expression, Folder, Note, Table } from '@axis-dsl/desmos';

/** Posix-ish resolution: relative to the importing file, `.axis` implied. */
const resolve = (specifier: string, from: string): string => {
    const target = specifier.endsWith('.axis') ? specifier : `${specifier}.axis`;
    const segments = [...from.split('/').slice(0, -1), ...target.split('/')];
    const path: string[] = [];

    for (const segment of segments) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') path.pop();
        else path.push(segment);
    }

    return `/${path.join('/')}`;
};

const ENTRY = '/main.axis';

/** Compile `script` as `/main.axis`, with `files` on disk beside it. */
const compile = (script: string, files: Record<string, string> = {}) =>
    compileAxis(script, {
        path: ENTRY,
        resolveImport: createImportResolver(new Map(Object.entries(files)), resolve),
    });

const titles = (result: { expressions: DesmosExpression[] }) =>
    result.expressions.filter(e => e.type === 'folder').map(e => (e as Folder).title);

describe('imports', () => {
    test('drops an imported script into a folder named after the file', () => {
        const result = compile('import "./lib/curves.axis"', { '/lib/curves.axis': 'y = x^2' });
        const [folder, expression] = result.expressions as [Folder, Expression];

        assert.equal(folder.type, 'folder');
        assert.equal(folder.title, 'curves');
        assert.equal(expression.latex, 'y=x^2');
        assert.equal(expression.folderId, folder.id);
    });

    test('implies the .axis extension', () => {
        const result = compile('import "./curves"', { '/curves.axis': 'y = x' });
        assert.deepEqual(titles(result), ['curves']);
    });

    test('takes its folder name from `as`, and its metadata from the statement', () => {
        const result = compile('import "./curves.axis" as "Nice curves" # secret: true', {
            '/curves.axis': 'y = x',
        });
        const folder = result.expressions[0] as Folder;

        assert.equal(folder.title, 'Nice curves');
        assert.equal(folder.secret, true);
    });

    test('starts the folder collapsed, unless the import says otherwise', () => {
        const files = { '/curves.axis': 'y = x' };
        const collapsed = (source: string) =>
            (compile(source, files).expressions[0] as Folder).collapsed;

        assert.equal(collapsed('import "./curves.axis"'), true);
        // A folder Desmos does not collapse carries no `collapsed` at all.
        assert.equal(collapsed('import "./curves.axis" # collapsed: false'), undefined);
    });

    test('flattens the folders inside the imported file away', () => {
        const result = compile('import "./lib.axis"', {
            '/lib.axis': 'a = 1\nfolder "Inner" {\n    b = 2\n    "note"\n}\nc = 3',
        });

        assert.deepEqual(titles(result), ['lib']);
        const folderId = result.expressions[0].id;
        assert.deepEqual(
            result.expressions.slice(1).map(e => (e as Expression).folderId),
            [folderId, folderId, folderId, folderId],
        );
        assert.equal((result.expressions[3] as Note).text, 'note');
    });

    test('keeps everything an imported file makes, tables included', () => {
        const result = compile('import "./lib.axis"', {
            '/lib.axis': 'table {\n    x = [1, 2],\n    y = [1, 4]\n}',
        });
        const [folder, table] = result.expressions as [Folder, Table];

        assert.equal(table.type, 'table');
        assert.equal(table.folderId, folder.id);
        assert.equal(table.columns.length, 2);
    });

    test('merges into the folder it is imported into, rather than nesting', () => {
        const result = compile('folder "Outer" {\n    import "./lib.axis"\n}', {
            '/lib.axis': 'y = x',
        });

        assert.deepEqual(titles(result), ['Outer']);
        const [outer, curve] = result.expressions as [Folder, Expression];
        assert.equal(curve.folderId, outer.id);
    });

    test('flattens a transitive import into the same folder', () => {
        const result = compile('import "./a.axis"', {
            '/a.axis': 'a = 1\nimport "./b.axis"',
            '/b.axis': 'b = 2',
        });

        assert.deepEqual(titles(result), ['a']);
        const folderId = result.expressions[0].id;
        assert.deepEqual(
            result.expressions.slice(1).map(e => (e as Expression).latex),
            ['a=1', 'b=2'],
        );
        assert.ok(result.expressions.slice(1).every(e => (e as Expression).folderId === folderId));
    });

    test('reports every file it read, transitively', () => {
        const result = compile('import "./a.axis"\nimport "./a.axis" as "Again"', {
            '/a.axis': 'import "./nested/b.axis"',
            '/nested/b.axis': 'b = 2',
        });

        assert.deepEqual(result.imports, ['/a.axis', '/nested/b.axis']);
    });

    test('lets the importing script override an imported config', () => {
        const result = compile('config {\n    degreeMode: false\n}\nimport "./a.axis"', {
            '/a.axis': 'config {\n    degreeMode: true,\n    showGrid: false\n}',
        });

        assert.deepEqual(result.settings, { degreeMode: false, showGrid: false });
    });

    test('numbers expressions across files without collision', () => {
        const result = compile('y = x\nimport "./a.axis"', { '/a.axis': 'z = 1\nw = 2' });
        assert.equal(new Set(result.expressions.map(e => e.id)).size, result.expressions.length);
    });

    test('fails on an import that cannot be resolved', () => {
        assert.throws(() => compile('import "./missing.axis"'), /Cannot resolve import/);
    });

    test('fails when the host offers no way to resolve imports at all', () => {
        assert.throws(() => compileAxis('import "./a.axis"'), /Cannot resolve import/);
    });

    test('fails on a malformed import', () => {
        assert.throws(() => compile('import ./a.axis'), /not a valid import/);
    });

    test('reports a cycle rather than following it', () => {
        // A file that imports the entry back is resolvable — loadImports hands
        // it over for exactly this reason — so the cycle is what stops it.
        const source = 'import "./a.axis"';
        assert.throws(
            () => compile(source, { '/a.axis': 'import "./main.axis"', '/main.axis': source }),
            /Import cycle: \/main\.axis -> \/a\.axis -> \/main\.axis/,
        );
    });

    test('reports a file that imports itself', () => {
        assert.throws(
            () => compile('import "./a.axis"', { '/a.axis': 'import "./a.axis"' }),
            /Import cycle/,
        );
    });
});

describe('finding imports', () => {
    test('finds them wherever they are written', () => {
        const source = 'y = x\nimport "./a.axis"\nfolder "F" { import "./b.axis" }';
        assert.deepEqual(findImports(source), ['./a.axis', './b.axis']);
    });

    test('is not fooled by a note or a name that starts with the word', () => {
        assert.deepEqual(findImports('"import me"\nimportant = 1'), []);
    });
});

describe('loading imports', () => {
    /** A host over an in-memory set of files. */
    const hostFor = (files: Record<string, string>) => ({
        resolve,
        read: async (path: string) => {
            const source = files[path];
            if (source === undefined) {
                throw new Error('ENOENT');
            }
            return source;
        },
    });

    test('walks the graph and hands the compiler what it needs', async () => {
        const files = { '/a.axis': 'import "./nested/b.axis"', '/nested/b.axis': 'b = 2' };
        const source = 'import "./a.axis"';

        const loaded = await loadImports({ path: ENTRY, source }, hostFor(files));
        assert.deepEqual([...loaded.keys()], ['/a.axis', '/nested/b.axis']);

        const result = compileAxis(source, {
            path: ENTRY,
            resolveImport: createImportResolver(loaded, resolve),
        });
        assert.deepEqual(
            result.expressions.map(e => e.type),
            ['folder', 'expression'],
        );
    });

    test('names the file that asked for a missing import', async () => {
        await assert.rejects(
            loadImports({ path: ENTRY, source: 'import "./a.axis"' }, hostFor({})),
            /Cannot read "\.\/a\.axis", imported by \/main\.axis/,
        );
    });

    test('terminates on a cycle, leaving the compiler to report it', async () => {
        const files = { '/a.axis': 'import "./main.axis"' };
        const loaded = await loadImports(
            { path: ENTRY, source: 'import "./a.axis"' },
            hostFor(files),
        );

        assert.deepEqual([...loaded.keys()].sort(), ['/a.axis', '/main.axis']);
    });
});
