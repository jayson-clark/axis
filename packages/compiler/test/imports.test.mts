// ═════════════════════════════════════════════════════════════════════════════
// Imports - a script built out of several files
// ═════════════════════════════════════════════════════════════════════════════
//
// Spec §7: an imported file lands in one folder of its own, flattened; an
// import inside a folder joins that folder; the entry's config and ticker win;
// a cycle is an error. And spec §6 and §4.5: macros and styles are in scope
// across the whole import graph.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Expression, Folder, Note, Table } from '@axis-dsl/desmos';
import { AXIS_DEFAULT_CONFIG } from '@axis-dsl/syntax';
import { createImportResolver, findImports, loadImports } from '../dist/index.js';
import {
    compileAxis,
    compileWith,
    ENTRY,
    resolvePath,
    withExtension,
    type CompilationResult,
} from './support/compile.mts';

const list = (result: CompilationResult) => result.state.expressions?.list ?? [];
const titles = (result: CompilationResult) =>
    list(result)
        .filter(item => item.type === 'folder')
        .map(item => (item as Folder).title);
const latex = (result: CompilationResult) =>
    list(result)
        .filter(item => item.type === 'expression')
        .map(item => (item as Expression).latex);

describe('imports', () => {
    test('drop an imported script into a folder named after the file', () => {
        const result = compileWith('import "./lib/curves.axis"', { '/lib/curves.axis': 'y = x^2' });
        const [folder, expression] = list(result) as [Folder, Expression];

        assert.equal(folder.title, 'curves');
        assert.equal(expression.latex, 'y=x^{2}');
        assert.equal(expression.folderId, folder.id);
        assert.deepEqual(result.diagnostics, []);
    });

    test('imply the .axis extension', () => {
        assert.deepEqual(titles(compileWith('import "./curves"', { '/curves.axis': 'y = x' })), [
            'curves',
        ]);
    });

    test('take the folder’s title from `as`, and its metadata from the statement', () => {
        const result = compileWith('import "./curves" as "Nice curves" @ secret, hidden', {
            '/curves.axis': 'y = x',
        });
        const folder = list(result)[0] as Folder;

        assert.equal(folder.title, 'Nice curves');
        assert.equal(folder.secret, true);
        assert.equal(folder.hidden, true);
    });

    test('start the folder collapsed, unless the import says otherwise', () => {
        const files = { '/curves.axis': 'y = x' };
        assert.equal((list(compileWith('import "./curves"', files))[0] as Folder).collapsed, true);
        // A folder Desmos does not collapse carries no `collapsed` at all.
        assert.ok(
            !('collapsed' in list(compileWith('import "./curves" @ collapsed: false', files))[0]),
        );
    });

    test('flatten the folders inside the imported file away', () => {
        const result = compileWith('import "./lib"', {
            '/lib.axis': 'a = 1\nfolder "Inner" {\n    b = 2\n    "note"\n}\nfolder { c = 3 }',
        });

        assert.deepEqual(titles(result), ['lib']);
        const [folder, ...rest] = list(result);
        assert.deepEqual(
            rest.map(item => (item as Expression).folderId),
            [folder.id, folder.id, folder.id, folder.id],
        );
        assert.equal((rest[2] as Note).text, 'note');
    });

    test('keep everything an imported file makes, tables included', () => {
        const [folder, table] = list(
            compileWith('import "./lib"', { '/lib.axis': 'table { x = [1, 2]; y = [1, 4] }' }),
        ) as [Folder, Table];

        assert.equal(table.type, 'table');
        assert.equal(table.folderId, folder.id);
    });

    test('join the folder they are imported into, rather than nesting', () => {
        const result = compileWith('folder "Outer" {\n    import "./lib"\n}', {
            '/lib.axis': 'y = x',
        });
        const [outer, curve] = list(result) as [Folder, Expression];

        assert.deepEqual(titles(result), ['Outer']);
        assert.equal(curve.folderId, outer.id);
    });

    test('flatten a transitive import into the same folder', () => {
        const result = compileWith('import "./a"', {
            '/a.axis': 'a = 1\nimport "./b"',
            '/b.axis': 'b = 2',
        });

        assert.deepEqual(titles(result), ['a']);
        const [folder, ...rest] = list(result);
        assert.deepEqual(latex(result), ['a=1', 'b=2']);
        assert.ok(rest.every(item => (item as Expression).folderId === folder.id));
    });

    test('include a file imported twice once', () => {
        // The second copy would define every name again, which Desmos rejects.
        const result = compileWith('import "./a"\nimport "./b"', {
            '/a.axis': 'import "./lib"',
            '/b.axis': 'import "./lib"',
            '/lib.axis': 'k = 1',
        });

        assert.deepEqual(latex(result), ['k=1']);
        assert.deepEqual(result.diagnostics, []);
    });

    test('report every file read, transitively, as a dependency', () => {
        const result = compileWith('import "./a"\nimport "./a" as "Again"', {
            '/a.axis': 'import "./nested/b"',
            '/nested/b.axis': 'b = 2',
        });
        assert.deepEqual(result.dependencies.imports, ['/a.axis', '/nested/b.axis']);
    });

    test('let the importing script override an imported config', () => {
        const result = compileWith('config { degreeMode: false }\nimport "./a"', {
            '/a.axis': 'config {\n    degreeMode: true\n    showGrid: false\n    xmin: 0\n}',
        });

        assert.deepEqual(result.options, {
            ...AXIS_DEFAULT_CONFIG,
            degreeMode: false,
            showGrid: false,
        });
        assert.equal(result.state.graph?.viewport?.xmin, 0);
        assert.equal(result.configOrigin?.path, ENTRY);
    });

    test('number items across files without collision', () => {
        const result = compileWith('y = x\nimport "./a"', { '/a.axis': 'z = 1\nw = 2' });
        const ids = list(result).map(item => item.id);
        assert.equal(new Set(ids).size, ids.length);
    });

    test('put an imported file’s definitions in scope for the script', () => {
        const result = compileWith('import "./lib"\ny = wave(x)', {
            '/lib.axis': 'wave(x) = sin(x)',
        });
        assert.deepEqual(result.diagnostics, []);
    });

    test('report an imported file’s own problems against it', () => {
        const result = compileWith('import "./lib"', { '/lib.axis': '\ny = nope(x, 1)' });
        const [diagnostic] = result.diagnostics;

        assert.equal(diagnostic.code, 'unknown-function');
        assert.equal(diagnostic.path, '/lib.axis');
    });
});

describe('an import that goes wrong', () => {
    test('is a diagnostic when it cannot be resolved', () => {
        const result = compileWith('y = x\nimport "./missing"');
        const [diagnostic] = result.diagnostics;

        assert.equal(diagnostic.code, 'unresolved-import');
        assert.match(diagnostic.message, /Cannot resolve import "\.\/missing" from \/main\.axis/);
        assert.equal(diagnostic.path, undefined);
        // And the rest of the script still compiles.
        assert.deepEqual(latex(result), ['y=x']);
    });

    test('is a diagnostic when the host gave no way to resolve imports at all', () => {
        assert.deepEqual(
            compileAxis('import "./a"').diagnostics.map(diagnostic => diagnostic.code),
            ['unresolved-import'],
        );
    });

    test('reports a cycle against the import that closes it', () => {
        const source = 'import "./a"';
        const result = compileWith(source, { '/a.axis': 'import "./main"', '/main.axis': source });
        const [diagnostic] = result.diagnostics;

        assert.equal(diagnostic.code, 'import-cycle');
        assert.match(diagnostic.message, /\/main\.axis -> \/a\.axis -> \/main\.axis/);
        assert.equal(diagnostic.path, '/a.axis');
    });

    test('reports a file that imports itself', () => {
        const result = compileWith('import "./a"', { '/a.axis': 'import "./a"' });
        assert.deepEqual(
            result.diagnostics.map(diagnostic => diagnostic.code),
            ['import-cycle'],
        );
    });
});

describe('macros and styles across imports', () => {
    test('an imported file brings its macros with it', () => {
        const result = compileWith('import "./lib"\ny = TAU * x', {
            '/lib.axis': 'macro TAU = 6.28',
        });
        assert.deepEqual(latex(result), ['y=6.28\\cdot x']);
    });

    test('they are in scope above the import', () => {
        const result = compileWith('y = TAU\nimport "./lib"', { '/lib.axis': 'macro TAU = 6.28' });
        assert.deepEqual(latex(result), ['y=6.28']);
    });

    test('a macro reaches through an import of an import', () => {
        const result = compileWith('import "./a"\ny = TAU', {
            '/a.axis': 'import "./b"',
            '/b.axis': 'macro TAU = 6.28',
        });
        assert.deepEqual(latex(result), ['y=6.28']);
    });

    test('an imported file may use a macro the entry defines', () => {
        const result = compileWith('macro D(v) = 2 * v\nimport "./lib"', {
            '/lib.axis': 'y = D(x)',
        });
        assert.deepEqual(latex(result), ['y=2\\cdot x']);
    });

    test('two files defining one macro is an error, even alike', () => {
        const result = compileWith('import "./a"\nimport "./b"', {
            '/a.axis': 'macro TAU = 6.28',
            '/b.axis': 'macro TAU = 6.28',
        });
        const [diagnostic] = result.diagnostics;

        assert.equal(diagnostic.code, 'duplicate-macro');
        assert.equal(diagnostic.path, '/b.axis');
        assert.match(diagnostic.message, /first in \/a\.axis/);
    });

    test('a style defined in an import is used in the script', () => {
        const result = compileWith('import "./lib"\ny = x @ use: loud', {
            '/lib.axis': 'style loud { color: RED; lineWidth: 5 }',
        });
        const curve = list(result).at(-1) as Expression;

        assert.equal(curve.color, '#c74440');
        assert.equal(curve.lineWidth, '5');
    });
});

describe('finding imports', () => {
    test('finds them wherever they are written', () => {
        const source = 'y = x\nimport "./a.axis"\nfolder "F" { import "./b" }';
        assert.deepEqual(findImports(source), ['./a.axis', './b']);
    });

    test('is not fooled by a note or a name that starts with the word', () => {
        assert.deepEqual(findImports('"import me"\nimportant = 1\n// import "x"'), []);
    });
});

describe('loading imports', () => {
    const hostFor = (files: Record<string, string>) => ({
        resolve: (specifier: string, from: string) => resolvePath(withExtension(specifier), from),
        read: async (path: string) => {
            const source = files[path];
            if (source === undefined) {
                throw new Error('ENOENT');
            }
            return source;
        },
    });

    test('walks the graph and hands the compiler what it needs', async () => {
        const files = { '/a.axis': 'import "./nested/b"', '/nested/b.axis': 'b = 2' };
        const source = 'import "./a"';
        const host = hostFor(files);

        const loaded = await loadImports({ path: ENTRY, source }, host);
        assert.deepEqual([...loaded.keys()], ['/a.axis', '/nested/b.axis']);

        const result = compileAxis(source, {
            path: ENTRY,
            resolveImport: createImportResolver(loaded, host.resolve),
        });
        assert.deepEqual(
            list(result).map(item => item.type),
            ['folder', 'expression'],
        );
    });

    test('leaves a file it cannot read to the compiler, which says where it was imported', async () => {
        const host = hostFor({});
        const source = 'import "./a"';
        const loaded = await loadImports({ path: ENTRY, source }, host);

        assert.equal(loaded.size, 0);
        const result = compileAxis(source, {
            path: ENTRY,
            resolveImport: createImportResolver(loaded, host.resolve),
        });
        assert.equal(result.diagnostics[0].code, 'unresolved-import');
    });

    test('terminates on a cycle, leaving the compiler to report it', async () => {
        const loaded = await loadImports(
            { path: ENTRY, source: 'import "./a"' },
            hostFor({ '/a.axis': 'import "./main"' }),
        );
        assert.deepEqual([...loaded.keys()].sort(), ['/a.axis', '/main.axis']);
    });
});
