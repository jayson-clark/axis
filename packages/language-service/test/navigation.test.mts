import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    getDefinition,
    getDocumentHighlights,
    getDocumentSymbols,
    getFoldingRanges,
    getReferences,
} from '../dist/index.js';
import type { DocumentSymbol } from '../dist/index.js';
import { examples, positionOf, textOf } from './support.mts';
import { resolveFrom } from './imports.mts';

/** Where the definition of the `n`th `needle` is, as `line:character`. */
const definitionOf = (source: string, needle: string, n = 0, options = {}) =>
    getDefinition(source, positionOf(source, needle, n, 1), options).map(
        location =>
            `${location.uri ?? ''}@${location.range.start.line}:${location.range.start.character}`,
    );

/** The text of every reference to the `n`th `needle`, with where it is. */
const referencesOf = (source: string, needle: string, n = 0, includeDeclaration = true) =>
    getReferences(source, positionOf(source, needle, n, 1), { includeDeclaration }).map(
        range => `${range.start.line}:${range.start.character}`,
    );

describe('go to definition', () => {
    test('finds a variable and a function, wherever they are used', () => {
        const source = 'y = amp f(x)\namp = 2\nf(t) = t ^ 2';
        assert.deepEqual(definitionOf(source, 'amp'), ['@1:0']);
        assert.deepEqual(definitionOf(source, 'f'), ['@2:0']);
    });

    test('finds a parameter inside its function, and the global outside it', () => {
        const source = 'a = 1\nf(a) = a + 1\ny = a';
        assert.deepEqual(definitionOf(source, 'a', 2), ['@1:2']);
        assert.deepEqual(definitionOf(source, 'a', 3), ['@0:0']);
    });

    test('finds a macro and a style', () => {
        const source =
            'y = wave(2) @ use: loud\nmacro wave(k) = sin(k x)\nstyle loud { color: RED }';
        assert.deepEqual(definitionOf(source, 'wave'), ['@1:6']);
        assert.deepEqual(definitionOf(source, 'loud'), ['@2:6']);
    });

    test('finds a with binding', () => {
        const source = 'y = n x with n = 3';
        assert.deepEqual(definitionOf(source, 'n'), ['@0:13']);
    });

    test('finds a definition inside a folder, and a table column', () => {
        const source = 'folder "F" { depth = 2 }\ntable { L_1 = [1, 2] }\ny = depth + L_1';
        assert.deepEqual(definitionOf(source, 'depth', 1), ['@0:13']);
        assert.deepEqual(definitionOf(source, 'L_1', 1), ['@1:8']);
    });

    test('finds the definition from the definition itself', () => {
        assert.deepEqual(definitionOf('k = 3', 'k'), ['@0:0']);
    });

    test('has nowhere to go for a builtin, a property or an undefined name', () => {
        assert.deepEqual(definitionOf('y = sin(x)', 'sin'), []);
        assert.deepEqual(definitionOf('y = x @ color: RED', 'color'), []);
        assert.deepEqual(definitionOf('y = zz', 'zz'), []);
    });

    test('follows a name into the file an import brings it from', () => {
        const options = {
            path: '/main.axis',
            resolveImport: resolveFrom({
                '/lib/waves.axis': '// Waves\nwave(x) = sin(x)\nstyle faint { lineOpacity: 0.3 }',
            }),
        };
        const source = 'import "./lib/waves"\ny = wave(x) @ use: faint';
        assert.deepEqual(definitionOf(source, 'wave', 1, options), ['/lib/waves.axis@1:0']);
        assert.deepEqual(definitionOf(source, 'faint', 0, options), ['/lib/waves.axis@2:6']);
    });
});

describe('references and highlights', () => {
    test('finds every use of a name, its definition included', () => {
        const source = 'a = 1\ny = a + a\nf(t) = a t';
        assert.deepEqual(referencesOf(source, 'a', 1), ['0:0', '1:4', '1:8', '2:7']);
        assert.deepEqual(referencesOf(source, 'a', 1, false), ['1:4', '1:8', '2:7']);
    });

    test('keeps a parameter to its function', () => {
        const source = 'x0 = 1\nf(x0) = x0 + 1\ny = x0';
        assert.deepEqual(referencesOf(source, 'x0', 2), ['1:2', '1:8']);
        assert.deepEqual(referencesOf(source, 'x0', 3), ['0:0', '2:4']);
    });

    test('finds a style wherever `use:` names it', () => {
        const source = 'style loud { color: RED }\ny = x @ use: loud\nstyle t { use: loud }';
        assert.deepEqual(referencesOf(source, 'loud', 0), ['0:6', '1:13', '2:15']);
    });

    test('finds a name nothing defines wherever it is used', () => {
        const source = 'y = k x\nz = k';
        assert.deepEqual(referencesOf(source, 'k', 0), ['0:4', '1:4']);
    });

    test('marks the definition a write and the uses reads', () => {
        const source = 'a = 1\ny = a';
        const highlights = getDocumentHighlights(source, positionOf(source, 'a', 1, 1));
        assert.deepEqual(
            highlights.map(highlight => [textOf(source, highlight.range), highlight.kind]),
            [
                ['a', 'write'],
                ['a', 'read'],
            ],
        );
    });

    test('highlights nothing over a builtin or a keyword', () => {
        assert.deepEqual(getDocumentHighlights('y = sin(x)', { line: 0, character: 5 }), []);
        assert.deepEqual(getDocumentHighlights('folder { }', { line: 0, character: 1 }), []);
    });
});

describe('the outline', () => {
    const outline = (symbols: DocumentSymbol[]): unknown[] =>
        symbols.map(symbol =>
            symbol.children
                ? [symbol.kind, symbol.name, outline(symbol.children)]
                : [symbol.kind, symbol.name],
        );

    test('lists every kind of statement with a name, folders holding their own', () => {
        const source = [
            'config { showGrid: false }',
            'style loud { color: RED }',
            'macro wave(k) = sin(k x)',
            'import "./lib/waves" as "Waves"',
            'image "./a.png"',
            '"A note"',
            'a = 1',
            'y = x',
            'folder "F" {',
            '    f(t) = t ^ 2',
            '    table { L_1 = [1, 2]; y = 3 }',
            '}',
            'ticker a -> a + 1',
        ].join('\n');
        assert.deepEqual(outline(getDocumentSymbols(source)), [
            ['config', 'config', [['property', 'showGrid']]],
            ['style', 'loud', [['property', 'color']]],
            ['macro', 'wave'],
            ['import', './lib/waves'],
            ['image', './a.png'],
            ['note', 'A note'],
            ['variable', 'a'],
            [
                'folder',
                'F',
                [
                    ['function', 'f'],
                    ['table', 'table', [['variable', 'L_1']]],
                ],
            ],
            ['ticker', 'ticker'],
        ]);
    });

    test('gives each symbol its statement, and its name to reveal', () => {
        const source = 'y = 1\nf(t) = t ^ 2 @ color: RED';
        // `y = 1` is an equation, not a definition, and has no symbol.
        const [f] = getDocumentSymbols(source);
        assert.equal(textOf(source, f.range), 'f(t) = t ^ 2 @ color: RED');
        assert.equal(textOf(source, f.selectionRange), 'f');
        assert.equal(f.detail, '(t) = t ^ 2');
    });

    test('names an untitled folder, and says what a macro stands for', () => {
        const [folder, macro] = getDocumentSymbols('folder { a = 1 }\nmacro TAU2 = 2tau');
        assert.equal(folder.name, '(untitled folder)');
        assert.equal(macro.detail, '= 2tau');
    });

    for (const { name, source } of examples) {
        test(`outlines ${name} without losing a definition`, () => {
            const flat = (symbols: DocumentSymbol[]): DocumentSymbol[] =>
                symbols.flatMap(symbol => [symbol, ...flat(symbol.children ?? [])]);
            const names = flat(getDocumentSymbols(source))
                .filter(symbol => symbol.kind === 'variable' || symbol.kind === 'function')
                .map(symbol => symbol.name);
            for (const match of source.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)(\([^)]*\))? = /gm)) {
                if (['x', 'y', 'r', 'theta'].includes(match[1])) continue;
                assert.ok(names.includes(match[1]), `${match[1]} missing from the outline`);
            }
        });
    }
});

describe('folding', () => {
    test('folds a block to its closing brace', () => {
        const ranges = getFoldingRanges('folder "A" {\n    a = 1\n    b = 2\n}\n');
        assert.deepEqual(ranges, [{ startLine: 0, endLine: 2 }]);
    });

    test('folds a metadata block inside a folder', () => {
        const source = 'folder "A" {\n    y = x @{\n        color: RED\n        hidden\n    }\n}';
        assert.deepEqual(getFoldingRanges(source), [
            { startLine: 0, endLine: 4 },
            { startLine: 1, endLine: 3 },
        ]);
    });

    test('folds a statement spread over lines, and a run of comments', () => {
        const source = '// one\n// two\nL = [\n    1,\n    2\n]\ny = x';
        assert.deepEqual(getFoldingRanges(source), [
            { startLine: 0, endLine: 1, kind: 'comment' },
            { startLine: 2, endLine: 4 },
        ]);
    });

    test('folds nothing on one line', () => {
        assert.deepEqual(getFoldingRanges('folder "A" { a = 1 }\n// one'), []);
    });
});
