import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatAxisCode, validateAxis, withAxisExtension } from '@axis-dsl/language';
import { compileAxis } from '../dist/index.js';
import type { Expression, Folder, GraphImage, Note, Table } from '@axis-dsl/desmos';

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

describe('images', () => {
    test('compiles the statement into the image it places', () => {
        const image = only<GraphImage>(
            'image "https://example.com/a.png" # name: "A", center: (1, 2), width: 4, height: 3',
        );
        assert.equal(image.type, 'image');
        assert.equal(image.image_url, 'https://example.com/a.png');
        assert.equal(image.name, 'A');
        assert.equal(image.center, '\\left(1,2\\right)');
        assert.equal(image.width, '4');
        assert.equal(image.height, '3');
    });

    test('converts every placement property, which Desmos holds as latex', () => {
        // None of them need be a literal: an image can be sized by a slider and
        // centred on a point the graph works out.
        const image = only<GraphImage>(
            'image "a.png" # center: (x0, y0), width: 10 * s, angle: -pi / 200, opacity: 0.5',
        );
        assert.equal(image.center, '\\left(x_{0},y_{0}\\right)');
        assert.equal(image.width, '10\\cdot s');
        assert.equal(image.angle, '-\\frac{\\pi}{200}');
        assert.equal(image.opacity, '0.5');
    });

    test('carries the flags an image shares with every other statement', () => {
        const image = only<GraphImage>('image "a.png" # foreground: true, hidden');
        assert.equal(image.foreground, true);
        assert.equal(image.hidden, true);
    });
});

describe('the blank row', () => {
    test('compiles a line that is metadata and nothing else', () => {
        // Desmos lets a graph keep an empty row for spacing. It has a colour
        // and no expression, and a line of metadata alone is how Axis says so.
        const [first, blank, last] = compile('y = x\n# color: #c74440\nz = 1') as Expression[];
        assert.equal(first.latex, 'y=x');
        assert.equal(blank.latex, undefined);
        assert.equal(blank.color, '#c74440');
        assert.equal(last.latex, 'z=1');
    });

    test('leaves a hash that is not metadata alone', () => {
        assert.equal(only<Expression>('y = x # ff0000').latex, 'y=x#f_{f0000}');
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

describe('macros', () => {
    test('substitutes an object-like macro and emits nothing for the definition', () => {
        const expressions = compile('macro TAU 6.28\ny = sin(TAU * x)');
        assert.equal(expressions.length, 1);
        assert.equal((expressions[0] as Expression).latex, 'y=\\sin\\left(6.28\\cdot x\\right)');
    });

    test('substitutes a call with the arguments it was given', () => {
        const expression = only<Expression>(
            'macro LERP(a, b, t) a + (b - a) * t\ny = LERP(0, 10, x)',
        );
        assert.equal(expression.latex, 'y=0+\\left(10-0\\right)\\cdot x');
    });

    test('is in scope above its own definition, since definitions are hoisted', () => {
        const expression = only<Expression>('y = TAU\nmacro TAU 6.28');
        assert.equal(expression.latex, 'y=6.28');
    });

    test('expands into a statement of any kind, metadata included', () => {
        const expression = only<Expression>('macro CURVE y = x^2 # color: red\nCURVE');
        assert.equal(expression.latex, 'y=x^2');
        assert.equal(expression.color, 'red');
    });

    test('expands into the ticker, which is read after substitution', () => {
        const { ticker } = compileAxis('macro STEP(v) v -> v + 1\nticker STEP(a)');
        assert.equal(ticker?.handlerLatex, 'a\\to a+1');
    });

    test('expands inside a folder and a table', () => {
        const expressions = compile(
            'macro ROW [1, 2, 3]\nfolder "A" {\n    table {\n        x = ROW\n    }\n}',
        );
        assert.equal((expressions[1] as Table).columns[0].values?.join(','), '1,2,3');
    });

    test('brackets an argument spliced against a coefficient', () => {
        // `2n` with `n` given as `1` is two, not twenty-one.
        assert.equal(only<Expression>('macro D(n) 2n\ny = D(1)').latex, 'y=2\\left(1\\right)');
    });

    test('expands into a run of metadata, however the run is spelt', () => {
        // The `#` may be on the statement or in the body, and the body may be
        // the `#{ … }` spelling of the same run: an expansion is source, and is
        // read by the same passes that read what was written by hand.
        for (const source of [
            'macro STYLE color: blue\n(0, 0) # STYLE',
            'macro STYLE {color: blue}\n(0, 0) #STYLE',
            'macro STYLE #{color: blue}\n(0, 0) STYLE',
            'macro STYLE # color: blue\n(0, 0) STYLE',
        ]) {
            assert.equal(only<Expression>(source).color, 'blue', source);
        }
    });

    test('expands into a block, which is then read as one', () => {
        const [folder, expression] = compile('macro BOX folder "A" { y = x }\nBOX') as [
            Folder,
            Expression,
        ];
        assert.equal(folder.title, 'A');
        assert.equal(expression.folderId, folder.id);
    });

    test('expands into a table column', () => {
        const table = only<Table>('macro ROW x = [1, 2]\ntable {\n    ROW\n}');
        assert.deepEqual(table.columns[0].values, ['1', '2']);
    });

    test('leaves a macro name inside a note as the word it is', () => {
        const note = only<Note>('macro TAU 6.28\n"TAU is a macro"');
        assert.equal(note.text, 'TAU is a macro');
    });

    test('a variable called macro is still a variable', () => {
        assert.equal(only<Expression>('macro = 3').latex, 'm_{acro}=3');
    });

    test('refuses a call the definition cannot take', () => {
        assert.throws(() => compile('macro F(a) a\ny = F(1, 2)'), /takes 1 argument/);
    });

    test('refuses a definition it cannot read', () => {
        assert.throws(() => compile('macro F'), /has no body/);
    });
});

describe('a metadata block', () => {
    test('reads as the run it is the other spelling of', () => {
        const run = compileAxis('y = x # color: #c74440, lineWidth: 3, lineStyle: DASHED');
        const block = compileAxis(
            'y = x #{\n    color: #c74440\n    lineWidth: 3\n    lineStyle: DASHED\n}',
        );
        assert.deepEqual(block, run);
    });

    test('takes a comma between two properties on one line', () => {
        assert.deepEqual(
            compileAxis('y = x #{ color: red, lineWidth: 3 }'),
            compileAxis('y = x # color: red, lineWidth: 3'),
        );
    });

    test('keeps a `{…}` value whole across the lines around it', () => {
        const slider = only<Expression>(
            'a = 1 #{\n    sliderBounds: {min: 0, max: 5, step: 0.5}\n    playing: true\n}',
        );

        assert.deepEqual(slider.slider, {
            min: '0',
            max: '5',
            hardMin: true,
            hardMax: true,
            step: '0.5',
            isPlaying: true,
        });
    });

    test('annotates a folder from inside its brace', () => {
        const [folder] = compileAxis('folder "A" { #{\n    collapsed: true\n}\n    y = x\n}')
            .expressions as [Folder];

        assert.equal(folder.title, 'A');
        assert.equal(folder.collapsed, true);
    });

    test('annotates a table column like any other entry', () => {
        const [table] = compileAxis(
            'table {\n    x = [1, 2]\n    y = [3, 4] #{\n        color: #388c46\n    }\n}',
        ).expressions as [Table];

        assert.equal(table.columns[1].color, '#388c46');
    });

    test('opens the blank row where it annotates nothing', () => {
        // Properties and no expression is the row Desmos keeps for spacing.
        const blank = only<Expression>('#{\n    color: #c74440\n}');

        assert.equal(blank.latex, undefined);
        assert.equal(blank.color, '#c74440');
    });

    test('carries the ticker’s own properties', () => {
        const { ticker } = compileAxis(
            'ticker a -> a + 1 #{\n    minStep: 50\n    playing: true\n}',
        );

        assert.equal(ticker?.minStepLatex, '50');
        assert.equal(ticker?.playing, true);
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
        // Desmos says "switched off" by leaving `enabled` off rather than by
        // storing `false`, so the action stays and the flag simply is not there.
        const expression = only<Expression>('p = (1,2) # onClick: a -> a + 1, clickable: false');
        assert.equal(expression.clickableInfo?.enabled, undefined);
        assert.equal(expression.clickableInfo?.latex, 'a\\to a+1');
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

    test('a property the script never set is left off the expression entirely', () => {
        // Not `undefined` under the key: Desmos reads the key as present and
        // decides nothing for itself, so a point handed `dragMode: undefined`
        // arrives frozen rather than draggable.
        const expression = only<Expression>('(1, 2)');
        assert.deepEqual(Object.keys(expression), ['type', 'id', 'latex']);

        for (const source of [
            '(1, 2)',
            '"a note"',
            'folder "F" {\n    y = x\n}',
            'table {\n    x = [1, 2]\n}',
        ]) {
            for (const compiled of compile(source)) {
                const undefinedKeys = Object.entries(compiled)
                    .filter(([, value]) => value === undefined)
                    .map(([key]) => key);
                assert.deepEqual(undefinedKeys, [], `${source} left ${undefinedKeys} undefined`);
            }
        }
    });

    test('a table column leaves its unset properties off too', () => {
        const [column] = only<Table>('table {\n    x = [1, 2]\n}').columns;
        assert.deepEqual(
            Object.entries(column)
                .filter(([, value]) => value === undefined)
                .map(([key]) => key),
            [],
        );
    });
});

describe('layout', () => {
    test('a script written inline compiles the same as one written out', () => {
        const inline = compileAxis('folder "A" { y = x, z = 1 }');
        const expanded = compileAxis('folder "A" {\n    y = x,\n    z = 1\n}');
        assert.deepEqual(inline, expanded);
    });

    test('a block separates its entries by their newlines, as the top level does', () => {
        const separated = compileAxis('folder "A" {\n    y = x,\n    z = 1\n}');
        assert.deepEqual(compileAxis('folder "A" {\n    y = x\n    z = 1\n}'), separated);
    });

    test('a table and a config block do the same', () => {
        assert.deepEqual(
            compileAxis('table {\n    x = [1, 2]\n    y = [3, 4]\n}'),
            compileAxis('table {\n    x = [1, 2],\n    y = [3, 4]\n}'),
        );
        assert.deepEqual(
            compileAxis('config {\n    showGrid: false\n    degreeMode: true\n}'),
            compileAxis('config {\n    showGrid: false,\n    degreeMode: true\n}'),
        );
    });

    test('joins a statement split across an open bracket', () => {
        const expression = only<Expression>('P = [\n    (0,0),\n    (4,0)\n]');
        // Desmos takes list brackets bare; only parens and braces are sized.
        assert.equal(expression.latex, 'P=\\left[\\left(0,0\\right),\\left(4,0\\right)\\right]');
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
