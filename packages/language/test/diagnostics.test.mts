import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    findImportStatements,
    missingImportDiagnostic,
    validateAxis,
    type AxisDiagnosticCode,
} from '../dist/index.js';

const codes = (source: string): AxisDiagnosticCode[] =>
    validateAxis(source).map(diagnostic => diagnostic.code);

describe('brackets', () => {
    test('reports a bracket left open, at the bracket', () => {
        const [diagnostic, ...rest] = validateAxis('y = (x');
        assert.deepEqual(rest, []);
        assert.equal(diagnostic.code, 'unclosed-bracket');
        assert.equal(diagnostic.severity, 'error');
        assert.deepEqual(
            [diagnostic.line, diagnostic.startCharacter, diagnostic.endCharacter],
            [0, 4, 5],
        );
    });

    test('reports a closer with nothing open', () => {
        assert.deepEqual(codes('y = x)'), ['unmatched-bracket']);
    });

    test('reports a closer of the wrong kind', () => {
        assert.deepEqual(codes('y = (x]'), ['mismatched-bracket']);
    });

    test('ignores brackets inside strings and comments', () => {
        assert.deepEqual(codes('"an unmatched ( here"'), []);
        assert.deepEqual(codes('y = x // an unmatched ( here'), []);
    });

    test('reports a string with no closing quote', () => {
        assert.deepEqual(codes('y = "abc'), ['unterminated-string']);
    });
});

describe('block headers', () => {
    test('accepts the canonical spellings', () => {
        assert.deepEqual(codes('folder "A" {\ny = x\n}'), []);
        assert.deepEqual(codes('table {\nx = [1]\n}'), []);
        assert.deepEqual(codes('config {\nshowGrid: true\n}'), []);
    });

    test('accepts metadata on a block header', () => {
        assert.deepEqual(codes('folder "A" { # collapsed: true\n}'), []);
    });

    test('accepts header metadata alongside entries that carry their own', () => {
        assert.deepEqual(
            codes(
                'folder "Closed by default" { # collapsed: true\n' +
                    'y = sin(2x) # color: #388c46,\n' +
                    'y = cos(2x) # color: #6042a6\n' +
                    '}',
            ),
            [],
        );
    });

    test('rejects a folder with no name', () => {
        assert.deepEqual(codes('folder {\n}'), ['block-header']);
    });

    test('rejects a folder named with an empty string', () => {
        // Not the same mistake as `folder {`: the shape is right, so the header
        // reads as a folder everywhere except the compiler, which will not take
        // an empty title and compiles the line as an expression instead.
        assert.deepEqual(codes('folder "" {\ny = x\n}'), ['empty-folder-name']);
        assert.deepEqual(codes('folder "" { # collapsed: true\ny = x\n}'), ['empty-folder-name']);
    });

    test('leaves a folder whose name is only spaces alone', () => {
        // Desmos takes it, and shows a folder with a blank label - odd, but the
        // author's business rather than an error.
        assert.deepEqual(codes('folder "  " {\ny = x\n}'), []);
    });

    test('rejects a nested folder', () => {
        assert.deepEqual(codes('folder "A" {\nfolder "B" {\n}\n}'), ['nested-folder']);
    });

    test('rejects a config block inside another block', () => {
        assert.deepEqual(codes('folder "A" {\nconfig {\n}\n}'), ['config-placement']);
    });

    test('warns about a second config block', () => {
        assert.deepEqual(codes('config {\n}\nconfig {\n}'), ['duplicate-config']);
    });
});

describe('imports', () => {
    test('accepts an import, with or without a name', () => {
        assert.deepEqual(codes('import "./a.axis"'), []);
        assert.deepEqual(codes('import "./a.axis" as "A" # collapsed: true'), []);
        assert.deepEqual(codes('folder "F" {\n    import "./a.axis"\n}'), []);
    });

    test('reports an import that is not a quoted path', () => {
        assert.deepEqual(codes('import ./a.axis'), ['import-syntax']);
        assert.deepEqual(codes('import "./a.axis" as A'), ['import-syntax']);
    });

    test('reports an import in a block that cannot hold one', () => {
        assert.deepEqual(codes('table {\n    import "./a.axis"\n}'), ['import-placement']);
    });

    test('leaves a name that merely starts with the word alone', () => {
        assert.deepEqual(codes('important = 1'), []);
    });

    test('locates the path an import names, for a host to go looking', () => {
        const [found, ...rest] = findImportStatements('y = x\nimport "./lib/a.axis" as "A"');

        assert.deepEqual(rest, []);
        assert.equal(found.specifier, './lib/a.axis');
        assert.equal(found.title, 'A');
        // The path itself, quotes included - not the whole statement.
        assert.deepEqual([found.line, found.startCharacter, found.endCharacter], [1, 7, 21]);
    });

    test('locates an import written inline inside a folder', () => {
        const [found] = findImportStatements('folder "F" { import "./a.axis" }');
        assert.equal(found.specifier, './a.axis');
        assert.deepEqual([found.line, found.startCharacter, found.endCharacter], [0, 20, 30]);
    });

    test('locates nothing in a malformed import, which is reported as syntax', () => {
        assert.deepEqual(findImportStatements('import ./a.axis'), []);
    });

    test('builds the diagnostic a host reports when the file is not there', () => {
        const [found] = findImportStatements('import "./a.axis"');
        const diagnostic = missingImportDiagnostic(found);

        assert.equal(diagnostic.code, 'import-not-found');
        assert.equal(diagnostic.severity, 'error');
        assert.match(diagnostic.message, /Cannot find "\.\/a\.axis"/);
        assert.deepEqual(
            [diagnostic.line, diagnostic.startCharacter, diagnostic.endCharacter],
            [found.line, found.startCharacter, found.endCharacter],
        );
    });
});

describe('the ticker', () => {
    test('accepts a ticker at the top level, with or without properties', () => {
        assert.deepEqual(codes('ticker a -> a + 1'), []);
        assert.deepEqual(codes('ticker a -> a + 1 # minStep: 50, playing: true, open: true'), []);
    });

    test('reports a ticker with no action to run', () => {
        assert.deepEqual(codes('ticker'), ['empty-ticker']);
    });

    test('reports a ticker written inside a block, since the graph has one', () => {
        assert.deepEqual(codes('folder "F" {\n    ticker a -> a + 1\n}'), ['ticker-placement']);
    });

    test('warns on an expression property written on a ticker, and the reverse', () => {
        assert.deepEqual(codes('ticker a -> a + 1 # lineWidth: 3'), ['unknown-metadata-property']);
        assert.deepEqual(codes('y = x # minStep: 50'), ['unknown-metadata-property']);
    });

    test('leaves a name that merely starts with the word alone', () => {
        assert.deepEqual(codes('tickerRate = 3'), []);
        assert.deepEqual(codes('ticker = 3'), []);
    });
});

describe('entries', () => {
    test('separates two entries on two lines by the newline between them', () => {
        assert.deepEqual(codes('table {\n  x = [1]\n  y = [2]\n}'), []);
        assert.deepEqual(codes('folder "F" {\n  y = x\n  y = 2x\n}'), []);
    });

    test('reports two entries run together on one line', () => {
        assert.deepEqual(codes('table { x = [1] y = [2] }'), ['missing-comma']);
    });

    test('accepts a block written inline', () => {
        assert.deepEqual(codes('table { x = [1, 2], y = [1, 4] }'), []);
    });

    test('takes a for binding as part of the entry, not a second one', () => {
        // `for` and `with` bind names of their own, so the `=` after one is
        // theirs - not a statement that has run into this one.
        assert.deepEqual(codes('folder "F" {\n  y = 1,\n  x = a for a = [-10, 10]\n}'), []);
        assert.deepEqual(codes('folder "F" {\n  y = 1,\n  z = n a with a = 2\n}'), []);
    });

    test('takes the newline after such a binding as the end of the entry', () => {
        assert.deepEqual(codes('folder "F" {\n  x = a for a = [1, 2]\n  y = 3\n}'), []);
    });

    test('lets a statement carry on past the bracket it was wrapped across', () => {
        // The comma belongs after the `for`, which ends the entry - not after
        // the `)`, which only ends the call the entry was written across.
        const wrapped =
            'folder "F" {\n  polygon(\n    (1, 2),\n    (3, 4)\n  )for a = [1, 2],\n  y = x\n}';
        assert.deepEqual(codes(wrapped), []);
    });

    test('reports a wrapped entry that really is missing its comma', () => {
        const wrapped = 'folder "F" {\n  polygon(\n    (1, 2),\n    (3, 4)\n  ) y = x\n}';
        assert.deepEqual(codes(wrapped), ['missing-comma']);
    });

    test('still separates the entries of an ordinary bracket by commas', () => {
        assert.deepEqual(codes('P = [\n  (0, 0)\n  (4, 0)\n]'), ['missing-comma']);
    });

    test('reports a config entry that is not `key: value`', () => {
        assert.deepEqual(codes('config {\nshowGrid\n}'), ['entry-syntax']);
    });

    test('reports a property with no value', () => {
        assert.deepEqual(codes('config {\nshowGrid:\n}'), ['missing-value']);
    });
});

describe('property names', () => {
    test('warns, rather than errors, on an unknown metadata property', () => {
        const [diagnostic] = validateAxis('y = x # colr: red');
        assert.equal(diagnostic.code, 'unknown-metadata-property');
        assert.equal(diagnostic.severity, 'warning');
    });

    test('warns on an unknown config property', () => {
        assert.deepEqual(codes('config {\nshowGrud: true\n}'), ['unknown-config-property']);
    });

    test('accepts the bare metadata flags', () => {
        assert.deepEqual(codes('y = x # hidden'), []);
        assert.deepEqual(codes('y = x # secret'), []);
    });
});

test('reports diagnostics in document order', () => {
    const diagnostics = validateAxis('y = x)\nz = (1\nw = x]');
    const positions = diagnostics.map(d => [d.line, d.startCharacter]);
    assert.deepEqual(
        positions,
        [...positions].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    );
});

test('a clean document reports nothing', () => {
    assert.deepEqual(
        codes(
            [
                '// a comment',
                'config { showGrid: true }',
                '"A note"',
                'folder "Curves" {',
                '    f(x) = x^2 # color: #c74440,',
                '    g(x) = sin(x) # lineWidth: 2',
                '}',
                'table { x = [1, 2], y = [1, 4] }',
            ].join('\n'),
        ),
        [],
    );
});
