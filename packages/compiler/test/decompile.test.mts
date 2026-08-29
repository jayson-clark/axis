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
    assert.deepEqual(again.graph, graph.graph);
    assert.deepEqual(again.ticker, graph.ticker);

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

describe('the properties Desmos holds as latex', () => {
    test('reads a width, an opacity and a colour back as the expressions they are', () => {
        // None of them need be a number: an opacity can be a list, a width can
        // be worked out from the viewport. Written back as raw latex they would
        // be compiled a second time and come out mangled.
        assert.equal(
            roundTrip('P = (0, 0) # fillOpacity: [1, 0.8], colorLatex: rgb(1, 2, 3)'),
            'P = (0, 0) # colorLatex: rgb(1, 2, 3), fillOpacity: [1, 0.8]\n',
        );
    });

    test('keeps a slider bound that is an expression rather than a number', () => {
        assert.equal(
            roundTrip('s = 0 # sliderBounds: {min: {w >= 10: -w + 10, 0}, max: w - 10}'),
            's = 0 # sliderBounds: {min: {w >= 10: -w + 10, 0}, max: w - 10}\n',
        );
    });

    test('leaves out the end of a slider the graph never named', () => {
        // Desmos says "the usual floor" by carrying no floor at all, so writing
        // one back would pin a slider whose author only raised its ceiling.
        const source = roundTrip(
            't = 0 # sliderBounds: {max: 236, hardMin: false, hardMax: false}',
        );
        assert.equal(source, 't = 0 # sliderBounds: {max: 236, hardMin: false, hardMax: false}\n');
        assert.deepEqual((recompile(source)[0] as Expression).slider, { max: '236' });
    });

    test('carries the animation a slider runs with', () => {
        assert.equal(
            roundTrip('a = 0 # playing: true, loopMode: LOOP_FORWARD, animationPeriod: 8000'),
            'a = 0 # playing: true, loopMode: LOOP_FORWARD, animationPeriod: 8000\n',
        );
        assert.equal(
            roundTrip('b = 1 # sliderBounds: {min: 10, max: 28}, playDirection: -1'),
            'b = 1 # sliderBounds: {min: 10, max: 28}, playDirection: -1\n',
        );
    });
});

describe('the range a curve is drawn over', () => {
    test('writes one domain and sets both keys Desmos keeps', () => {
        assert.equal(
            roundTrip('(cos(t), sin(t)) # domain: {min: 0, max: 2pi}'),
            '(cos(t), sin(t)) # domain: {min: 0, max: 2pi}\n',
        );
        const [curve] = recompile('(cos(t), sin(t)) # domain: {min: 0, max: 2pi}') as Expression[];
        assert.deepEqual(curve.domain, { min: '0', max: '2\\pi' });
        assert.deepEqual(curve.parametricDomain, { min: '0', max: '2\\pi' });
    });

    test('writes the older copy out only when the two disagree', () => {
        // Desmos writes an unset lower bound as `0` under one key and as the
        // empty string under the other, so a graph off desmos.com really does
        // carry two that differ.
        const decompiled = decompileAxis({
            expressions: [
                {
                    type: 'expression',
                    id: '1',
                    latex: '\\left(\\cos t,\\sin t\\right)',
                    domain: { min: '0', max: '2\\pi' },
                    parametricDomain: { min: '', max: '2\\pi' },
                },
            ],
        });

        assert.match(decompiled, /parametricDomain: \{min: "", max: 2pi\}/);
        const [curve] = compileAxis(decompiled).expressions as Expression[];
        assert.deepEqual(curve.parametricDomain, { min: '', max: '2\\pi' });
    });
});

describe('images', () => {
    test('writes the URL as the statement and the placement behind it', () => {
        assert.equal(
            roundTrip('image "a.png" # name: "Reference", center: (1, 2), width: 4, height: 3'),
            'image "a.png" # name: Reference, center: (1, 2), width: 4, height: 3\n',
        );
    });

    test('reads a placement Desmos holds as an expression', () => {
        assert.equal(
            roundTrip('image "a.png" # center: (x0, y0), angle: -pi / 200, foreground: true'),
            'image "a.png" # center: (x0, y0), angle: -pi / 200, foreground: true\n',
        );
    });
});

describe('the blank row', () => {
    test('writes an expression with a colour and nothing else as its metadata', () => {
        assert.equal(
            roundTrip('y = x\n# color: #c74440\nz = 1'),
            'y = x\n# color: #c74440\nz = 1\n',
        );
    });

    test('still has nothing to write for a row with no properties either', () => {
        assert.equal(decompileAxis({ expressions: [{ type: 'expression', id: '1' }] }), '');
    });
});

describe('runs held together by a comma', () => {
    test('brackets a run of actions inside a folder, which the compiler unbrackets', () => {
        // A comma inside a folder separates one statement from the next, so the
        // run has to be written in brackets there; Desmos wants it bare, and
        // reads a bracketed one as a point instead.
        assert.equal(
            roundTrip('folder "F" {\n    reset = (a -> 0, b -> 0)\n}'),
            'folder "F" {\n    reset = (a -> 0, b -> 0)\n}\n',
        );
        const [, reset] = compileAxis('folder "F" {\n    reset = (a -> 0, b -> 0)\n}').expressions;
        assert.equal((reset as Expression).latex, 'r_{eset}=a\\to0,b\\to0');
    });

    test('reads a folder’s bare run of actions back into the brackets it needs', () => {
        assert.equal(
            decompileAxis({
                expressions: [
                    { type: 'folder', id: 'f', title: 'F' },
                    {
                        type: 'expression',
                        id: '1',
                        folderId: 'f',
                        latex: 'r_{eset}=a\\to0,b\\to0',
                    },
                ],
            }),
            'folder "F" {\n    reset = (a -> 0, b -> 0)\n}\n',
        );
    });

    test('brackets a folder’s run of actions hidden inside a piecewise', () => {
        // The arrows are branches rather than the top level, and the piecewise
        // holding them is still an action - so the run takes parentheses, not
        // the brackets a list is written with.
        const latex = 'C=\\left\\{p=0:a\\to1,a\\to0\\right\\},b\\to2';
        const decompiled = decompileAxis({
            expressions: [
                { type: 'folder', id: 'f', title: 'F' },
                { type: 'expression', id: '1', folderId: 'f', latex },
            ],
        });

        assert.match(decompiled, /\n {4}C = \(/);
        assert.equal(compileAxis(decompiled).expressions.length, 2);
    });

    test('leaves a run at the top level exactly as Desmos holds it', () => {
        // Nothing separates statements there but the newline, so the run needs
        // no brackets - and a run of names that happen to be actions could not
        // be bracketed correctly anyway, since only the arrow gives one away.
        assert.equal(
            decompileAxis({
                expressions: [
                    { type: 'expression', id: '1', latex: 'A_{1},A_{2}' },
                    { type: 'expression', id: '2', latex: 'r_{eset}=a\\to0,b\\to0' },
                ],
            }),
            'A1, A2\nreset = a -> 0, b -> 0\n',
        );
    });

    test('reads a bare run of points back as the run it is', () => {
        assert.equal(
            decompileAxis({
                expressions: [
                    { type: 'expression', id: '1', latex: '\\left(1,2\\right),\\left(3,4\\right)' },
                ],
            }),
            '(1, 2), (3, 4)\n',
        );
    });
});

describe('folders', () => {
    test('writes a folder around the expressions that claim it', () => {
        assert.equal(
            roundTrip('folder "Curves" {\ny = x,\ny = 2x\n}\ny = 3x'),
            'folder "Curves" {\n    y = x\n    y = 2x\n}\n\ny = 3x\n',
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
            'folder "F" {\n    "A note"\n    table {\n        x = [1, 2]\n    }\n    y = x\n}\n',
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
            'table {\n    x = [1, 2, 3]\n    y = [2, 4, 8]\n}\n',
        );
    });

    test('writes a computed column, which has no values of its own', () => {
        assert.equal(
            roundTrip('table {\nu = [-1, 0, 1],\nu^2 # color: #6042a6\n}'),
            'table {\n    u = [-1, 0, 1]\n    u ^ 2 # color: #6042a6\n}\n',
        );
    });

    test('writes a column’s styling behind it', () => {
        assert.equal(
            roundTrip('table {\nt = [0, 1],\npos = [0, 5] # color: #388c46, pointStyle: OPEN\n}'),
            'table {\n    t = [0, 1]\n    pos = [0, 5] # color: #388c46, pointStyle: OPEN\n}\n',
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

    test('writes a soft bound, which Desmos says by leaving the flag off', () => {
        assert.equal(
            roundTrip('a = 1 # sliderBounds: {min: 0, max: 10, hardMax: false}'),
            'a = 1 # sliderBounds: {min: 0, max: 10, hardMax: false}\n',
        );
        assert.equal(
            roundTrip('a = 1 # sliderBounds: {min: 0, max: 10, hardMin: false, hardMax: false}'),
            'a = 1 # sliderBounds: {min: 0, max: 10, hardMin: false, hardMax: false}\n',
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
            'config {\n    showGrid: false\n    xAxisLabel: "time (s)"\n    fontSize: 16\n}\n\ny = x\n',
        );
    });

    test('has no block to write for a script with no config', () => {
        assert.equal(roundTrip('y = x'), 'y = x\n');
    });

    test('writes the viewport back as the four edges it was written as', () => {
        // The compiler nests these into a viewport rectangle, because that is
        // the shape Desmos' state holds; the script says four flat keys, and
        // the round trip is what holds the two spellings to each other.
        assert.equal(
            roundTrip(
                'config {\nxmin: 0,\nxmax: 1,\nymin: 0,\nymax: 1,\nsquareAxes: false\n}\ny = x',
            ),
            'config {\n    xmin: 0\n    xmax: 1\n    ymin: 0\n    ymax: 1\n    squareAxes: false\n}\n\ny = x\n',
        );
    });

    test('writes a viewport alongside the settings that share its block', () => {
        assert.equal(
            roundTrip('config {\nshowGrid: false,\nxmin: -1,\nxmax: 1\n}\ny = x'),
            'config {\n    showGrid: false\n    xmin: -1\n    xmax: 1\n}\n\ny = x\n',
        );
    });

    test('reads a graph state\u2019s own nested viewport', () => {
        // What a state off desmos.com hands over, which is the shape the
        // compiler produces too - so it goes in unchanged.
        assert.equal(
            decompileAxis({
                expressions: [],
                graph: { viewport: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 } },
            }),
            'config {\n    xmin: 0\n    xmax: 1\n    ymin: 0\n    ymax: 1\n}\n',
        );
    });
});

describe('the ticker', () => {
    test('writes the statement back with the properties that pace it', () => {
        assert.equal(
            roundTrip('a = 0\nticker a -> a + 1 # minStep: 50, playing: true, open: true'),
            'ticker a -> a + 1 # minStep: 50, playing: true, open: true\n\na = 0\n',
        );
    });

    test('leaves out the properties Desmos says by omission', () => {
        assert.equal(roundTrip('a = 0\nticker a -> a + 1'), 'ticker a -> a + 1\n\na = 0\n');
    });

    test('does not write back the `actions` a ticker switched on for itself', () => {
        // The compiler adds it so the ticker runs at all; writing it out would
        // grow a config block the author never wrote, and the ticker standing
        // next to it puts the setting back anyway.
        const source = 'a = 0\nticker a -> a + 1';
        assert.equal(compileAxis(source).settings?.actions, true);
        assert.equal(roundTrip(source).includes('config'), false);
    });

    test('keeps an `actions` the script asked for itself', () => {
        assert.equal(
            roundTrip('config {\n    actions: false\n}\na = 0\nticker a -> a + 1'),
            'config {\n    actions: false\n}\n\nticker a -> a + 1\n\na = 0\n',
        );
    });

    test("reads a graph state's own ticker", () => {
        // What a state off desmos.com hands over: the ticker beside the list
        // rather than in it.
        assert.equal(
            decompileAxis({
                expressions: [],
                ticker: { handlerLatex: 'c_{ursorBlink}', playing: true, open: true },
            }),
            'ticker cursorBlink # playing: true, open: true\n',
        );
    });

    test('has nothing to write for a ticker with no handler', () => {
        assert.equal(decompileAxis({ expressions: [], ticker: { playing: true } }), '');
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
    test('escapes a note’s own line breaks, since a statement is one line', () => {
        const decompiled = decompileAxis({
            expressions: [{ type: 'text', id: 'n', text: 'first\nsecond' }],
        });

        assert.equal(decompiled, '"first\\nsecond"\n');
        assert.equal(
            (compileAxis(decompiled).expressions[0] as { text?: string }).text,
            'first\nsecond',
        );
    });

    test('reads a bare run of points as the one expression it is', () => {
        // Desmos lets a point list be written as a comma-separated run and
        // means nothing else by it. Nothing separates statements at the top
        // level but the newline, so the run stays exactly as it was written.
        const decompiled = decompileAxis({
            expressions: [
                {
                    type: 'expression',
                    id: '1',
                    latex: 'A=\\left(1,2\\right),\\left(3,4\\right)',
                },
            ],
        });

        assert.equal(decompiled, 'A = (1, 2), (3, 4)\n');
        assert.equal(compileAxis(decompiled).expressions.length, 1);
        assert.equal(
            (compileAxis(decompiled).expressions[0] as Expression).latex,
            'A=\\left(1,2\\right),\\left(3,4\\right)',
        );
    });

    test('leaves a run of actions bare, which is how Desmos runs one', () => {
        // Bracketing it would change what it means: Desmos answers
        // `\left[a\to1,b\to2\right]` with "Cannot store an action in a list".
        const decompiled = decompileAxis({
            expressions: [{ type: 'expression', id: '1', latex: 'C=a\\to1,b\\to2' }],
        });

        assert.equal(decompiled, 'C = a -> 1, b -> 2\n');
        assert.equal(compileAxis(decompiled).expressions.length, 1);
        assert.equal(
            (compileAxis(decompiled).expressions[0] as Expression).latex,
            'C=a\\to1,b\\to2',
        );
    });

    test('leaves a run of names that only the graph knows are actions', () => {
        // `A1, A2` is the multi-action that runs both, and nothing in the latex
        // says so - which is exactly why the run is not bracketed on a guess.
        const decompiled = decompileAxis({
            expressions: [{ type: 'expression', id: '1', latex: 'A_{1},A_{2}' }],
        });

        assert.equal(decompiled, 'A1, A2\n');
        assert.equal((compileAxis(decompiled).expressions[0] as Expression).latex, 'A_{1},A_{2}');
    });

    test('reads an unnamed run of points the same way', () => {
        const decompiled = decompileAxis({
            expressions: [
                { type: 'expression', id: '1', latex: '\\left(1,2\\right),\\left(3,4\\right)' },
            ],
        });

        assert.equal(decompiled, '(1, 2), (3, 4)\n');
        assert.equal(compileAxis(decompiled).expressions.length, 1);
    });

    test('leaves the commas that are already inside something alone', () => {
        // Parameters, a piecewise's branches and a bracketed list all hold
        // their commas below the top level, and none of them is a point run.
        for (const source of [
            'f(x, y) = x + y',
            'p(x) = {x < 0: -x, x}',
            'A = [(1, 2), (3, 4)]',
            'y <= 1',
            'a -> a + 1',
        ]) {
            assert.equal(roundTrip(source), `${source}\n`);
        }
    });

    test('escapes the quotes inside a note rather than changing them', () => {
        const decompiled = decompileAxis({
            expressions: [{ type: 'text', id: 'n', text: 'a "quoted" word' }],
        });

        assert.equal(decompiled, '"a \\"quoted\\" word"\n');
        assert.equal(
            (compileAxis(decompiled).expressions[0] as { text?: string }).text,
            'a "quoted" word',
        );
    });

    test('keeps a folder title that runs to several lines', () => {
        const decompiled = decompileAxis({
            expressions: [{ type: 'folder', id: 'f', title: 'LIBRARY\n\nby someone' }],
        });

        assert.equal(decompiled, 'folder "LIBRARY\\n\\nby someone" {\n}\n');
        assert.equal(
            (compileAxis(decompiled).expressions[0] as { title?: string }).title,
            'LIBRARY\n\nby someone',
        );
    });

    test('reads a note that was saved without a type as a note', () => {
        // A graph saved long enough ago writes one as a bare `text`, and a real
        // calculator still renders it; read as an expression it has no latex at
        // all and falls off the end of the script.
        const decompiled = decompileAxis({ expressions: [{ id: '1', text: 'older note' }] });

        assert.equal(decompiled, '"older note"\n');
        assert.equal(compileAxis(decompiled).expressions[0].type, 'text');
    });

    test('quotes a property value that leaves a bracket open', () => {
        // Metadata inside a block ends at the `}` closing the block around it,
        // so a label of `}` written bare would close the folder it sits in.
        const decompiled = decompileAxis({
            expressions: [
                { type: 'folder', id: 'f', title: 'F' },
                { type: 'expression', id: '1', latex: 'y=1', folderId: 'f', label: '}' },
                { type: 'text', id: 'n', text: 'after', folderId: 'f' },
            ],
        });

        assert.match(decompiled, /label: "\}"/);
        const out = compileAxis(decompiled).expressions;
        assert.equal(out.filter(e => e.type === 'text').length, 1, 'the note was swallowed');
        assert.equal((out[1] as { label?: string }).label, '}');
    });

    test('leaves an escape nobody defined alone, so a note can name LaTeX', () => {
        const text = 'use \\frac for a fraction';
        const decompiled = decompileAxis({ expressions: [{ type: 'text', id: 'n', text }] });

        assert.equal((compileAxis(decompiled).expressions[0] as { text?: string }).text, text);
        // And the same note written by hand, with the backslash left bare.
        assert.equal(
            (compileAxis('"use \\frac for a fraction"').expressions[0] as { text?: string }).text,
            text,
        );
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

describe('statements long enough to wrap', () => {
    /**
     * Long enough that the formatter breaks it at its branches, and with a
     * coefficient in front of the brace: `y = {` is read as the statement it is
     * either way, so it is the brace that arrives mid-expression - and lands at
     * the end of its line once wrapped - that the reader used to lose.
     */
    const piecewise =
        'y = 2.5 + 1.01{0 <= t < 1: flag(8t), 1 <= t < 2: flag(8) - h mod(t, 1),' +
        ' 2 <= t < 3: -h + flag(8 - 8mod(t, 1)), h(-1 + mod(t, 1))}';

    test('reads a wrapped piecewise back as one statement', () => {
        const decompiled = roundTrip(piecewise);

        // The test is only worth anything if it is long enough to have been
        // broken across lines in the first place.
        assert.ok(decompiled.trimEnd().includes('\n'), 'expected it to wrap');

        // A brace that ends a line used to be taken for a block opener, so the
        // branches came back as statements of their own.
        assert.equal(compileAxis(decompiled).expressions.length, 1);
    });

    test('indents a wrapped statement to the block holding it', () => {
        const decompiled = roundTrip(`folder "F" {\n${piecewise}\n}`);

        // Every line of the statement, not just the one the entry starts on.
        for (const line of decompiled.split('\n').slice(1, -2)) {
            assert.match(line, /^ {4}\S|^ {8}\S/, `not indented into the folder: ${line}`);
        }
    });
});

describe('sums, scripts and with', () => {
    test('reads a summation back with its bounds intact', () => {
        assert.equal(roundTrip('S = \\sum_(n = 0)^(N)n ^ (2)'), 'S = \\sum_(n = 0) ^ (N)n ^ (2)\n');
    });

    test('keeps a with clause, rather than reading it as a variable', () => {
        // Written closed up, `with` is the variable `w_{ith}` multiplying
        // whatever stands next to it - a different graph that Desmos accepts.
        assert.equal(roundTrip('f(y) = y n with n = 3'), 'f(y) = y n with n = 3\n');
    });

    test('round trips the shape a real graph writes all three in', () => {
        roundTrip(
            'B(x, y) = \\sum_(n = 0)^(z - 1)nCr(z - 1, n)(1 - x) ^ (z - n - 1)' +
                'x ^ (n) * y[n + 1] with z = length(y)',
        );
    });
});

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
