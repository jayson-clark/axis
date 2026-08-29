import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatAxisCode, validateAxis, withAxisExtension } from '@axis-dsl/language';
import { compileAxis } from '../dist/index.js';
import type { Expression, Folder, Note, Table } from '@axis-dsl/desmos';

const compile = (source: string) => compileAxis(source).expressions;
const only = <T,>(source: string) => compile(source)[0] as T;

describe('expressions', () => {
    test('compiles one statement into one expression', () => {
        const expression = only<Expression>('y = x^2');
        assert.equal(expression.type, 'expression');
        assert.equal(expression.latex, 'y=x^2');
    });

    test('skips blank lines and comments', () => {
        const expressions = compile('// a comment\n\ny = x\n');
        assert.equal(expressions.length, 1);
        assert.equal((expressions[0] as Expression).latex, 'y=x');
    });

    test('gives every expression a distinct id', () => {
        const ids = compile('y = x\nz = 1\nw = 2').map(e => e.id);
        assert.equal(new Set(ids).size, 3);
    });
});

describe('notes', () => {
    test('compiles a bare string into a note', () => {
        const note = only<Note>('"Getting started"');
        assert.equal(note.type, 'text');
        assert.equal(note.text, 'Getting started');
    });
});

describe('folders', () => {
    test('compiles a folder and puts its contents inside it', () => {
        const [folder, child] = compile('folder "Curves" {\ny = x\n}') as [Folder, Expression];
        assert.equal(folder.type, 'folder');
        assert.equal(folder.title, 'Curves');
        assert.equal(child.folderId, folder.id);
    });

    test('closes the folder at its brace', () => {
        const [, , after] = compile('folder "A" {\ny = x\n}\nz = 1') as Expression[];
        assert.equal(after.folderId, undefined);
    });

    test('reads collapsed off the header metadata', () => {
        const folder = only<Folder>('folder "A" { # collapsed: true\n}');
        assert.equal(folder.collapsed, true);
    });
});

describe('tables', () => {
    test('compiles a table written inline', () => {
        const table = only<Table>('table { x = [1, 2], y = [1, 4] }');
        assert.equal(table.type, 'table');
        assert.deepEqual(
            table.columns.map(column => [column.latex, column.values]),
            [
                ['x', ['1', '2']],
                ['y', ['1', '4']],
            ],
        );
    });

    test('compiles the same table written out', () => {
        const inline = only<Table>('table { x = [1, 2], y = [1, 4] }');
        const expanded = only<Table>('table {\n    x = [1, 2],\n    y = [1, 4]\n}');
        assert.deepEqual(expanded, inline);
    });
});

describe('config', () => {
    test('collects the config block into settings', () => {
        const { settings } = compileAxis('config {\n    showGrid: true,\n    fontSize: 16\n}');
        assert.deepEqual(settings, { showGrid: true, fontSize: 16 });
    });

    test('leaves settings undefined when there is no config block', () => {
        assert.equal(compileAxis('y = x').settings, undefined);
    });

    test('does not emit an expression for the config block', () => {
        assert.deepEqual(compile('config { showGrid: true }'), []);
    });
});

describe('the ticker', () => {
    test('compiles the statement into the ticker the state carries', () => {
        const { ticker } = compileAxis('a = 0\nticker a -> a + 1 # minStep: 50, playing: true');
        assert.deepEqual(ticker, {
            handlerLatex: 'a\\to a+1',
            minStepLatex: '50',
            playing: true,
        });
    });

    test('emits no expression for it - a ticker is not in the list', () => {
        assert.deepEqual(compile('ticker a -> a + 1'), []);
    });

    test('switches actions on, since `auto` cannot see a ticker', () => {
        assert.deepEqual(compileAxis('ticker a -> a + 1').settings, { actions: true });
        assert.deepEqual(
            compileAxis('config {\n    actions: false\n}\nticker a -> a + 1').settings,
            { actions: false },
        );
    });

    test('leaves the ticker undefined for a script that has none', () => {
        assert.equal(compileAxis('y = x').ticker, undefined);
        assert.equal(compileAxis('ticker').ticker, undefined);
    });

    test('a variable called ticker is still a variable', () => {
        const expression = only<Expression>('ticker = 3');
        assert.equal(expression.latex, 't_{icker}=3');
    });

    test('the entry script wins over an imported ticker', () => {
        const { ticker } = compileAxis('import "lib"\nticker b -> b + 1', {
            resolveImport: () => ({ path: 'lib', source: 'ticker a -> a + 1' }),
        });
        assert.equal(ticker?.handlerLatex, 'b\\to b+1');
    });

    test('an imported ticker applies when the entry script has none', () => {
        const { ticker } = compileAxis('import "lib"', {
            resolveImport: () => ({ path: 'lib', source: 'ticker a -> a + 1' }),
        });
        assert.equal(ticker?.handlerLatex, 'a\\to a+1');
    });
});

describe('metadata', () => {
    test('applies styling properties', () => {
        const expression = only<Expression>('y = x # color: #c74440, lineStyle: DASHED');
        assert.equal(expression.color, '#c74440');
        assert.equal(expression.lineStyle, 'DASHED');
    });

    test('keeps the always-string properties as strings', () => {
        const expression = only<Expression>('y = x # lineWidth: 2');
        assert.equal(expression.lineWidth, '2');
    });

    test('keeps a quoted value a string, whatever it looks like', () => {
        // Quotes are how a value says it is a string: without them `42` is the
        // number, which a string property has no use for.
        assert.equal(only<Expression>('(0,0) # label: "42"').label, '42');
        assert.equal(only<Expression>('(0,0) # label: "true"').label, 'true');
    });

    test('reads the bare flags', () => {
        assert.equal(only<Expression>('y = x # hidden').hidden, true);
        assert.equal(only<Expression>('y = x # secret').secret, true);
    });

    test('turns onClick into clickableInfo', () => {
        const expression = only<Expression>('p = (1,2) # onClick: a -> a + 1');
        assert.deepEqual(expression.clickableInfo, { enabled: true, latex: 'a\\to a+1' });
    });

    test('honours clickable: false', () => {
        const expression = only<Expression>('p = (1,2) # onClick: a -> a + 1, clickable: false');
        assert.equal(expression.clickableInfo?.enabled, false);
    });

    test('parses sliderBounds into the slider the graph state carries', () => {
        // Not `sliderBounds`: that is what `setExpression` takes, and nothing
        // applies expressions that way — folder membership needs `setState`,
        // which reads the serialized form instead.
        const expression = only<Expression>('a = 1 # sliderBounds: {min: 0, max: 10, step: 0.1}');
        assert.deepEqual(expression.slider, {
            min: '0',
            max: '10',
            step: '0.1',
            hardMin: true,
            hardMax: true,
        });
    });

    test('playing on its own animates without setting a range', () => {
        const expression = only<Expression>('a = 1 # playing: true');
        assert.deepEqual(expression.slider, { isPlaying: true });
    });
});

describe('layout', () => {
    test('a script written inline compiles the same as one written out', () => {
        const inline = compileAxis('folder "A" { y = x, z = 1 }');
        const expanded = compileAxis('folder "A" {\n    y = x,\n    z = 1\n}');
        assert.deepEqual(inline, expanded);
    });

    test('joins a statement split across an open bracket', () => {
        const expression = only<Expression>('P = [\n    (0,0),\n    (4,0)\n]');
        // Desmos takes list brackets bare; only parens and braces are sized.
        assert.equal(expression.latex, 'P=[\\left(0,0\\right),\\left(4,0\\right)]');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Formatting an example is a change to how it reads, not to what it graphs
// ═════════════════════════════════════════════════════════════════════════════
//
// The formatter breaks a long line at a bracket, one entry to a line, which is
// only safe because the compiler joins those lines back into the statement they
// came from. That join is easy to break from either side, and nothing about a
// wrapped script looks wrong until a graph comes out different - so every
// example is wrapped hard and compiled again here.

describe('wrapping an example script', () => {
    const directory = fileURLToPath(new URL('../../../examples/scripts/', import.meta.url));

    /** The examples import each other, so compiling one has to resolve those. */
    const resolveImport = (specifier: string, from: string) => {
        const target = withAxisExtension(specifier);
        const path = target.startsWith('/')
            ? resolve(directory, target.slice(1))
            : resolve(dirname(from), target);
        return { path, source: readFileSync(path, 'utf8') };
    };

    // Narrow enough that nearly every statement has to be broken, which is the
    // point: the default of 100 leaves most of them alone.
    const NARROW = { tabSize: 4, insertSpaces: true, maxLineLength: 30 };

    for (const name of readdirSync(directory).filter(file => file.endsWith('.axis'))) {
        test(`${name} graphs the same wrapped as it does whole`, () => {
            const path = resolve(directory, name);
            const source = readFileSync(path, 'utf8');
            const wrapped = formatAxisCode(source, NARROW);

            assert.deepEqual(validateAxis(wrapped), [], `wrapping ${name} broke the script`);
            assert.deepEqual(
                compileAxis(wrapped, { path, resolveImport }),
                compileAxis(source, { path, resolveImport }),
            );
            assert.equal(formatAxisCode(wrapped, NARROW), wrapped, 'wrapping is not idempotent');
        });
    }
});
