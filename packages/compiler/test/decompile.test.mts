// ═════════════════════════════════════════════════════════════════════════════
// A graph, back into the script that builds it
// ═════════════════════════════════════════════════════════════════════════════
//
// The cases here say what the source looks like; `roundTrip` says it is the
// right source, by compiling it again and demanding the same graph. Nearly
// every test does both, because either one alone would pass on output nobody
// wants: source that reads well and means something else, or source that means
// the right thing and could not have been written by hand.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Expression, Folder } from '@axis-dsl/desmos';
import { withAxisExtension } from '@axis-dsl/language';
import { compileAxis, decompileAxis } from '../dist/index.js';
import type { CompileOptions } from '../dist/index.js';

/**
 * Decompile a script, having checked that what comes back compiles to the graph
 * it was read from.
 *
 * This is the decompiler's whole contract - `compile ∘ decompile ∘ compile` is
 * `compile` - so every test goes through here rather than trusting the text it
 * asserts on.
 */
function roundTrip(source: string, options: CompileOptions = {}): string {
    const graph = compileAxis(source, options);
    const decompiled = decompileAxis(graph);
    const again = compileAxis(decompiled, options);

    assert.deepEqual(
        again.expressions,
        graph.expressions,
        `decompiled source compiled to a different graph:\n${decompiled}`,
    );
    assert.deepEqual(again.settings, graph.settings);

    return decompiled;
}

/** The graph a decompiled script produces, for asserting on a property of it. */
const recompile = (source: string) => compileAxis(roundTrip(source)).expressions;

describe('statements', () => {
    test('writes an expression with its metadata behind it', () => {
        assert.equal(
            roundTrip('y = x^2 # color: #c74440, lineWidth: 3'),
            'y = x ^ 2 # color: #c74440, lineWidth: 3\n',
        );
    });

    test('writes a note as the quoted string it was', () => {
        assert.equal(roundTrip('"Getting started"'), '"Getting started"\n');
    });

    test('writes the bare flags as the properties they set', () => {
        assert.equal(roundTrip('k = 10 # hidden'), 'k = 10 # hidden: true\n');
        assert.equal(roundTrip('s = 0.5 # secret'), 's = 0.5 # secret: true\n');
    });

    test('leaves out a property the graph does not set', () => {
        assert.equal(roundTrip('y = x'), 'y = x\n');
    });

    test('has nothing to say about an empty graph', () => {
        assert.equal(decompileAxis({ expressions: [] }), '');
    });

    test('skips an expression with no latex at all', () => {
        // Desmos keeps the empty row at the bottom of the list; there is no
        // statement that writes one.
        assert.equal(decompileAxis({ expressions: [{ type: 'expression', id: '1' }] }), '');
    });
});

describe('folders', () => {
    test('writes a folder around the expressions that claim it', () => {
        assert.equal(
            roundTrip('folder "Curves" {\ny = x,\ny = 2x\n}\ny = 3x'),
            'folder "Curves" {\n    y = x,\n    y = 2x\n}\n\ny = 3x\n',
        );
    });

    test('writes the flags a folder carries, and only when they are set', () => {
        assert.equal(
            roundTrip('folder "A" { # collapsed: true, secret: true\ny = x\n}'),
            'folder "A" { # collapsed: true, secret: true\n    y = x\n}\n',
        );
    });

    test('holds a note, a table and an expression as entries alike', () => {
        const source = roundTrip('folder "F" {\n"A note",\ntable { x = [1, 2] },\ny = x\n}');
        assert.equal(
            source,
            'folder "F" {\n    "A note",\n    table {\n        x = [1, 2]\n    },\n    y = x\n}\n',
        );
    });

    test('gathers a folder’s contents even when the list has scattered them', () => {
        const [folder, inside] = recompile('folder "F" {\ny = x\n}') as [Folder, Expression];
        const scattered = decompileAxis({
            expressions: [inside, folder, { type: 'expression', id: 'e', latex: 'y=2x' }],
        });

        assert.equal(scattered, 'folder "F" {\n    y = x\n}\n\ny = 2x\n');
    });

    test('writes an expression whose folder is not there at the top level', () => {
        assert.equal(
            decompileAxis({
                expressions: [{ type: 'expression', id: 'e', latex: 'y=x', folderId: 'gone' }],
            }),
            'y = x\n',
        );
    });

    test('writes a folder inside a folder as its sibling', () => {
        // Desmos has one level of folders, and this is what it does with a
        // second: the compiler opens it beside the first rather than in it.
        assert.equal(
            decompileAxis({
                expressions: [
                    { type: 'folder', id: 'outer', title: 'Outer' },
                    { type: 'folder', id: 'inner', title: 'Inner', folderId: 'outer' } as Folder,
                    { type: 'expression', id: 'e', latex: 'y=x', folderId: 'inner' },
                ],
            }),
            'folder "Outer" {\n}\n\nfolder "Inner" {\n    y = x\n}\n',
        );
    });
});

describe('tables', () => {
    test('writes a column and the values under it', () => {
        assert.equal(
            roundTrip('table {\nx = [1, 2, 3],\ny = [2, 4, 8]\n}'),
            'table {\n    x = [1, 2, 3],\n    y = [2, 4, 8]\n}\n',
        );
    });

    test('writes a computed column, which has no values of its own', () => {
        assert.equal(
            roundTrip('table {\nu = [-1, 0, 1],\nu^2 # color: #6042a6\n}'),
            'table {\n    u = [-1, 0, 1],\n    u ^ 2 # color: #6042a6\n}\n',
        );
    });

    test('writes a column’s styling behind it', () => {
        assert.equal(
            roundTrip('table {\nt = [0, 1],\npos = [0, 5] # color: #388c46, pointStyle: OPEN\n}'),
            'table {\n    t = [0, 1],\n    pos = [0, 5] # color: #388c46, pointStyle: OPEN\n}\n',
        );
    });
});

describe('sliders', () => {
    test('writes the bounds back as the object they were written as', () => {
        assert.equal(
            roundTrip('a = 1 # sliderBounds: {min: -5, max: 5, step: 0.5}'),
            'a = 1 # sliderBounds: {min: -5, max: 5, step: 0.5}\n',
        );
    });

    test('writes bounds with no step, and an animation with no bounds', () => {
        assert.equal(
            roundTrip('a = 1 # sliderBounds: {min: 0, max: 10}'),
            'a = 1 # sliderBounds: {min: 0, max: 10}\n',
        );
        assert.equal(roundTrip('a = 1 # playing: true'), 'a = 1 # playing: true\n');
    });

    test('writes a bound that is an expression rather than a number', () => {
        assert.equal(
            roundTrip('a = 1 # sliderBounds: {min: -2pi, max: 2pi}'),
            'a = 1 # sliderBounds: {min: -2pi, max: 2pi}\n',
        );
    });
});

describe('clickable objects', () => {
    test('writes the action back as the expression it compiles from', () => {
        assert.equal(roundTrip('(0, 0) # onClick: n -> n + 1'), '(0, 0) # onClick: n -> n + 1\n');
    });

    test('writes clickable: false, which keeps the action and switches it off', () => {
        assert.equal(
            roundTrip('(0, 0) # onClick: n -> 99, clickable: false'),
            '(0, 0) # onClick: n -> 99, clickable: false\n',
        );
    });

    test('writes a point made clickable with nothing to run', () => {
        assert.equal(roundTrip('(0, 0) # clickable: true'), '(0, 0) # clickable: true\n');
    });
});

describe('config', () => {
    test('writes the settings back as the block at the top of the script', () => {
        assert.equal(
            roundTrip(
                'config {\nshowGrid: false,\nxAxisLabel: "time (s)",\nfontSize: 16\n}\ny = x',
            ),
            'config {\n    showGrid: false,\n    xAxisLabel: "time (s)",\n    fontSize: 16\n}\n\ny = x\n',
        );
    });

    test('has no block to write for a script with no config', () => {
        assert.equal(roundTrip('y = x'), 'y = x\n');
    });
});

describe('quoting', () => {
    test('quotes a value with a space in it, and leaves a bare word alone', () => {
        assert.equal(
            roundTrip('(0, 0) # label: "x only", labelOrientation: above'),
            '(0, 0) # label: "x only", labelOrientation: above\n',
        );
    });

    test('quotes a label that would otherwise be read as a number', () => {
        const [point] = recompile('(0, 0) # label: "42"') as [Expression];
        assert.equal(point.label, '42');
        assert.equal(roundTrip('(0, 0) # label: "42"'), '(0, 0) # label: "42"\n');
    });

    test('quotes a value carrying a comma, which would otherwise split in two', () => {
        const [point] = recompile('(0, 0) # description: "one, two"') as [Expression];
        assert.equal(point.description, 'one, two');
    });

    test('keeps a hex colour bare, the way the examples read', () => {
        assert.equal(roundTrip('y = x # color: #c74440'), 'y = x # color: #c74440\n');
    });
});

describe('what a script says and a graph cannot', () => {
    test('turns a note’s own line breaks into spaces, since a note is one line', () => {
        const decompiled = decompileAxis({
            expressions: [{ type: 'text', id: 'n', text: 'first\nsecond' }],
        });

        assert.equal(decompiled, '"first second"\n');
        assert.equal(
            (compileAxis(decompiled).expressions[0] as { text?: string }).text,
            'first second',
        );
    });

    test('turns the quotes a note cannot escape into single ones', () => {
        const decompiled = decompileAxis({
            expressions: [{ type: 'text', id: 'n', text: 'a "quoted" word' }],
        });

        assert.equal(decompiled, `"a 'quoted' word"\n`);
        assert.deepEqual(compileAxis(decompiled).expressions.length, 1);
    });

    test('leaves a note that mentions a # a note', () => {
        const decompiled = decompileAxis({
            expressions: [{ type: 'text', id: 'n', text: 'step #1: begin' }],
        });

        assert.equal(
            (compileAxis(decompiled).expressions[0] as { text?: string }).text,
            'step #1: begin',
        );
    });

    test('writes an import back as the folder the reader sees', () => {
        // Nothing in the graph records where a folder's contents came from, so
        // an import comes back as the folder it was flattened into.
        const source = 'import "./lib.axis"';
        const options = {
            path: '/main.axis',
            resolveImport: () => ({ path: '/lib.axis', source: 'y = 2x' }),
        };

        assert.equal(
            roundTrip(source, options),
            'folder "lib" { # collapsed: true\n    y = 2x\n}\n',
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The round trip, over everything there is to run it over
// ─────────────────────────────────────────────────────────────────────────────

/** One statement of each kind the language has, none of them covered above. */
const SCRIPTS = [
    'y = 2x + 1\nc = 3\ny = c * x - 4',
    'f(x) = x^2 - 4x + 3\ng(x) = sin(x) + cos(2x)\ny = f(x) + g(x)',
    'p(x) = {x < 0: -x, x}\ny = x^2 {0 < x < 3}',
    'y = 3{x < 0: -1, 1}',
    'A = [(-5, -6), (-3, -5)] # color: #fa7e19, points: false',
    'y = mean([1, 2, 3]) + stdev([1, 2, 3])',
    'r = 2 + sin(4theta) # color: #c74440',
    'x^2 + y^2 <= 9 # color: #2d70b3, fillOpacity: 0.4, fill: true',
    '(0, 0) # label: "Origin", showLabel: true, labelSize: 2, labelOrientation: above',
    'y = x # lineStyle: DASHED, lineWidth: 4, lineOpacity: 0.6, hidden: true',
    'a = 1 # sliderBounds: {min: 0, max: 5, step: 0.1}, playing: true',
    'C = rgb(177, 75, 75)\ny = 0 # color: C',
    'y = (x + 1) / (x - 1)\nz = x / 2\nw = 1 + sqrt(x) / 2',
    'y = nthroot(x, 3) + abs(x) + |x|',
    'D = (0, 0) # dragMode: XY, description: "Drag me"',
    'config { degreeMode: true, backgroundColor: "#ffffff" }\ny = sin(x)',
];

describe('round trip', () => {
    for (const script of SCRIPTS) {
        test(script.split('\n', 1).join(''), () => {
            roundTrip(script);
        });
    }
});

/**
 * The examples are the widest use of the language there is, so they are the
 * widest test of reading it back: every statement, block and property the
 * documentation shows, through a compile it has to come out of unchanged.
 */
describe('round trip: the example scripts', () => {
    const directory = fileURLToPath(new URL('../../../examples/scripts/', import.meta.url));

    /** The examples import each other, so decompiling one has to resolve those. */
    const resolveImport = (specifier: string, from: string) => {
        const target = withAxisExtension(specifier);
        const path = target.startsWith('/')
            ? resolve(directory, target.slice(1))
            : resolve(dirname(from), target);
        return { path, source: readFileSync(path, 'utf8') };
    };

    for (const name of readdirSync(directory).filter(file => file.endsWith('.axis'))) {
        test(name, () => {
            const path = resolve(directory, name);
            roundTrip(readFileSync(path, 'utf8'), { path, resolveImport });
        });
    }
});
