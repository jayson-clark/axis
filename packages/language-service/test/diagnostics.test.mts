import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@axis-dsl/syntax';
import {
    getDiagnostics,
    getDocumentLinks,
    missingImageDiagnostic,
    missingImportDiagnostic,
} from '../dist/index.js';
import { examples, textOf } from './support.mts';
import { resolveExample, resolveFrom } from './imports.mts';

const codes = (source: string, options = {}) =>
    getDiagnostics(source, options).map(diagnostic => diagnostic.code);

describe('syntax diagnostics', () => {
    test('reports the parser’s diagnostics with their ranges', () => {
        const source = 'y = x\ny = x @ color:';
        const [diagnostic, ...rest] = getDiagnostics(source, { semantic: false });
        assert.deepEqual(rest, []);
        assert.equal(diagnostic.code, 'expected-value');
        assert.equal(diagnostic.severity, 'error');
        assert.equal(diagnostic.source, 'axis');
        assert.equal(textOf(source, diagnostic.range), 'color:');
        assert.deepEqual(diagnostic.range.start, { line: 1, character: 8 });
    });

    test('counts characters in UTF-16, as editors do', () => {
        // The emoji is two code units, so the brace after it is at 7, not 6.
        const source = '"🌊" @ {';
        const [diagnostic] = getDiagnostics(source, { semantic: false });
        assert.equal(diagnostic.range.start.character, 7);
    });

    test('takes a tree as readily as source', () => {
        const tree = parse('config {');
        assert.deepEqual(
            getDiagnostics(tree, { semantic: false }).map(d => d.code),
            ['unclosed-block'],
        );
    });

    test('reports them in document order', () => {
        const lines = getDiagnostics('a = (\nb = @\nc = ]', { semantic: false }).map(
            d => d.range.start.line,
        );
        assert.deepEqual(lines, [...lines].sort());
    });
});

describe('semantic diagnostics', () => {
    test('are the compiler’s by default', () => {
        assert.deepEqual(codes('mean = 3'), ['assign-to-builtin']);
        assert.deepEqual(codes('y = x @ color: red'), ['invalid-color']);
        assert.deepEqual(codes('notAFunction(x, 2)'), ['unknown-function']);
        assert.deepEqual(codes('(1, 2) @ collapsed'), ['misplaced-property']);
    });

    test('report a syntax error once, though the compiler reports it too', () => {
        assert.deepEqual(codes('y = x @ color:'), ['expected-value']);
    });

    test('report an import as unresolved without a resolver, as a compile does', () => {
        assert.deepEqual(codes('import "./lib/waves"'), ['unresolved-import']);
    });

    test('resolve imports through the host’s resolver', () => {
        const imports = examples.find(example => example.name === '16-imports.axis')!;
        assert.deepEqual(codes(imports.source, resolveExample('16-imports.axis')), []);
    });

    test('leave out what belongs to an imported file', () => {
        const resolveImport = resolveFrom({ '/lib.axis': 'mean = 3' });
        assert.deepEqual(codes('import "./lib.axis"', { path: '/main.axis', resolveImport }), []);
    });

    test('take a checker of the host’s instead', () => {
        const seen: string[] = [];
        const found = getDiagnostics('y = x', {
            semantic: tree => {
                seen.push(tree.source);
                return [
                    {
                        code: 'mine',
                        severity: 'warning',
                        message: 'Mine',
                        span: { start: 0, end: 1 },
                    },
                    // Another file's, which this document cannot show.
                    {
                        code: 'theirs',
                        severity: 'error',
                        message: 'Theirs',
                        span: { start: 0, end: 1 },
                        path: '/lib.axis',
                    },
                ];
            },
        });
        assert.deepEqual(seen, ['y = x']);
        assert.deepEqual(
            found.map(d => [d.code, d.severity]),
            [['mine', 'warning']],
        );
    });

    test('are off with `semantic: false`', () => {
        assert.deepEqual(codes('mean = 3', { semantic: false }), []);
    });

    for (const { name, source } of examples) {
        if (name.startsWith('lib/')) continue;
        test(`find nothing wrong with ${name}`, () => {
            assert.deepEqual(getDiagnostics(source, resolveExample(name)), []);
        });
    }
});

describe('missing files', () => {
    test('report an import whose file is not there, over its path', () => {
        const source = 'import "./gone.axis"';
        const [link] = getDocumentLinks(source);
        const diagnostic = missingImportDiagnostic(source, link);
        assert.equal(diagnostic.code, 'import-not-found');
        assert.equal(textOf(source, diagnostic.range), './gone.axis');
        assert.deepEqual(diagnostic.span, { start: 8, end: 19 });
        assert.match(diagnostic.message, /gone\.axis/);
    });

    test('report an image whose file is not there', () => {
        const source = 'y = x\nimage "./gone.png" @ width: 2';
        const [link] = getDocumentLinks(source);
        const diagnostic = missingImageDiagnostic(source, link);
        assert.equal(diagnostic.code, 'image-not-found');
        assert.equal(textOf(source, diagnostic.range), './gone.png');
    });
});
