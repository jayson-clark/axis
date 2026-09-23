// ═════════════════════════════════════════════════════════════════════════════
// A graph, back into the file that builds it
// ═════════════════════════════════════════════════════════════════════════════
//
// The cases here say what the source looks like; `roundTrip` says it is the
// right source, by compiling it again and demanding the same graph. Nearly
// every test does both, because either one alone would pass on output nobody
// wants: source that reads well and means something else, or source that means
// the right thing and could not have been written by hand.
//
// `roundTrip` also holds the decompiled source to being the formatter's own
// output and to parsing without a word, since the printer is what laid it out
// and a file the formatter would rewrite is one nobody typed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
    DesmosExpression,
    Expression,
    GraphImage,
    GraphState,
    Note,
    Table,
    TickerState,
} from '@axis-dsl/desmos';
import {
    AXIS_DEFAULT_CONFIG,
    AXIS_MANIFEST,
    format,
    parse,
    type PropertyDefinition,
} from '@axis-dsl/syntax';
import {
    decompileAxis,
    decompileExpression,
    decompileSettings,
    decompileTicker,
} from '../dist/index.js';
import { compileAxis, type CompileOptions } from './support/compile.mts';
import { EXAMPLES_DIRECTORY, exampleOptions } from './support/examples.mts';

/**
 * Decompile a file, having checked that what comes back compiles to the graph
 * it was read from, is already formatted, and parses cleanly.
 *
 * This is the decompiler's whole contract - `compile ∘ decompile ∘ compile` is
 * `compile` - so nearly every test goes through here rather than trusting the
 * text it asserts on.
 */
function roundTrip(source: string, options: CompileOptions = {}): string {
    const compiled = compileAxis(source, options);
    assert.deepEqual(compiled.diagnostics, [], `the file itself has problems:\n${source}`);

    const decompiled = decompileAxis(compiled);
    assert.deepEqual(decompiled.diagnostics, []);
    assertWellFormed(decompiled.source);

    const again = compileAxis(decompiled.source, options);
    assert.deepEqual(
        again.diagnostics,
        [],
        `decompiled source has problems:\n${decompiled.source}`,
    );
    assert.deepEqual(
        again.state,
        compiled.state,
        `decompiled source compiled to a different graph:\n${decompiled.source}`,
    );
    assert.deepEqual(again.options, compiled.options);

    return decompiled.source;
}

/** Decompile a hand-written state, checking only that the source is well formed. */
function fromState(state: Partial<GraphState>, options?: object): string {
    const { source, diagnostics } = decompileAxis({
        state: { version: 11, includeFunctionParametersInRandomSeed: true, ...state },
        options,
    });
    assert.deepEqual(diagnostics, []);
    assertWellFormed(source);
    return source;
}

/** A state holding just these items, in the shape `fromState` takes. */
const items = (...list: DesmosExpression[]): Partial<GraphState> => ({ expressions: { list } });

/** The source the formatter would leave alone and the parser reads without a word. */
function assertWellFormed(source: string): void {
    assert.deepEqual(parse(source).diagnostics, [], `does not parse:\n${source}`);
    assert.equal(format(source), source, 'is not what the formatter writes');
}

/** The list a file compiles to. */
const listOf = (source: string) => compileAxis(source).state.expressions?.list ?? [];

// ─────────────────────────────────────────────────────────────────────────────
// Every example
// ─────────────────────────────────────────────────────────────────────────────

describe('the examples', () => {
    for (const name of readdirSync(EXAMPLES_DIRECTORY).filter(file => file.endsWith('.axis'))) {
        test(`${name} decompiles to a file that builds the same graph`, () => {
            const path = resolve(EXAMPLES_DIRECTORY, name);
            roundTrip(readFileSync(path, 'utf8'), exampleOptions(path));
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Every property
// ─────────────────────────────────────────────────────────────────────────────
//
// Driven from the manifest, with a guard that fails when a property appears
// there with no case here: a property the decompiler cannot read back is one
// the round trip silently drops.

/** A statement that sets each property, as the property's placement needs it. */
const PROPERTY_CASES: Record<string, string[]> = {
    color: ['y = x @ color: RED', 'y = x @ color: #123456', 'y = x @ color: rgb(1, 2, 3)'],
    suppressTextOutline: ['(0, 0) @ label: "a", showLabel, suppressTextOutline'],
    lineStyle: ['y = x @ lineStyle: DASHED', 'y = x @ lineStyle: DOTTED'],
    lineWidth: ['y = x @ lineWidth: 5', 'a = 2\ny = x @ lineWidth: a + 1'],
    lineOpacity: ['y = x @ lineOpacity: 0.5'],
    pointStyle: ['(0, 0) @ pointStyle: SQUARE'],
    pointSize: ['(0, 0) @ pointSize: 14'],
    movablePointSize: [
        'a = 0\n(a, 0) @ pointSize: 14, movablePointSize: 20',
        'a = 0\n(a, 0) @ movablePointSize: 20',
    ],
    pointOpacity: ['(0, 0) @ pointOpacity: 0.25'],
    fillOpacity: ['y < x @ fillOpacity: 0.2'],
    hidden: ['y = x @ hidden', 'y = x @ hidden: false'],
    secret: ['y = x @ secret'],
    points: ['L = [(1, 2), (3, 4)] @ points: false'],
    lines: ['L = [(1, 2), (3, 4)] @ lines'],
    fill: ['polygon((0, 0), (1, 0), (0, 1)) @ fill', 'y < x @ fill: false'],
    label: ['(0, 0) @ label: "origin"', '(0, 0) @ label: ""'],
    showLabel: ['(0, 0) @ label: "a", showLabel'],
    labelSize: ['(0, 0) @ label: "a", showLabel, labelSize: 2'],
    labelOrientation: ['(0, 0) @ label: "a", labelOrientation: above_left'],
    pointOutline: ['(0, 0) @ pointOutline'],
    dragMode: ['a = 0\n(a, 0) @ dragMode: X', 'image "https://example.com/a.png" @ dragMode: XY'],
    playing: ['a = 0 @ playing', 'a = 0 @ playing: false', 'n = 0\nticker n -> n + 1 @ playing'],
    onClick: [
        'n = 0\n(0, 0) @ onClick: n -> n + 1',
        'a = 0\nb = 0\n(0, 0) @ onClick: a -> 1, b -> 2',
        'image "https://example.com/a.png" @ onClick: n -> 1\nn = 0',
    ],
    clickable: [
        'n = 0\n(0, 0) @ onClick: n -> n + 1, clickable: false',
        '(0, 0) @ clickable',
        '(0, 0) @ clickable: false',
    ],
    description: ['(0, 0) @ description: "the origin"'],
    slider: [
        'a = 1 @ slider: -5..5',
        'a = 1 @ slider: -5..5 step 0.5',
        'a = 1 @ slider: 0..',
        'a = 1 @ slider: ..5',
        'a = 1 @ slider: 0..5 soft',
        'a = 1 @ slider: 0..5 soft min',
        'a = 1 @ slider: 0..5 soft max',
        'a = 1 @ slider: -2pi..2pi step pi / 4',
        'm = 3\na = 1 @ slider: -m..m step m / 10',
    ],
    loopMode: [
        'a = 1 @ loopMode: PLAY_ONCE',
        'a = 1 @ slider: 0..5, playing, loopMode: LOOP_FORWARD',
    ],
    playDirection: ['a = 1 @ playDirection: -1'],
    animationPeriod: ['a = 1 @ animationPeriod: 4000'],
    domain: ['(cos(t), sin(t)) @ domain: 0..2pi', '(cos(t), sin(t)) @ domain: ..pi'],
    parametricDomain: ['(cos(t), sin(t)) @ domain: 0..pi, parametricDomain: 0..2pi'],
    polarDomain: ['r = theta @ polarDomain: 0..6pi'],
    name: ['image "https://example.com/a.png" @ name: "a picture"'],
    center: ['image "https://example.com/a.png" @ center: (1, 2)'],
    width: ['image "https://example.com/a.png" @ width: 4'],
    height: ['image "https://example.com/a.png" @ height: 3'],
    angle: ['image "https://example.com/a.png" @ angle: -pi / 200'],
    opacity: ['image "https://example.com/a.png" @ opacity: 0.5'],
    foreground: ['image "https://example.com/a.png" @ foreground'],
    collapsed: ['folder "F" { @ collapsed\n    y = x\n}'],
    minStep: ['n = 0\nticker n -> n + 1 @ minStep: 50'],
    open: ['n = 0\nticker n -> n + 1 @ open'],
};

/** A value to try for each config property, by its type. */
function configCases(definition: PropertyDefinition): string[] {
    switch (definition.valueType) {
        case 'boolean':
            return ['true', 'false'];
        case 'number':
            return ['3', '-2.5'];
        case 'string':
            return ['"a label"'];
        case 'enum':
            return [...(definition.values ?? [])];
        case 'color':
            return ['#123456', 'RED'];
    }
    return [];
}

describe('every property', () => {
    const metadata = [...AXIS_MANIFEST.metadata, ...AXIS_MANIFEST.tickerProperties];

    test('has a case here', () => {
        // `use` is resolved away before the graph, so there is nothing to read.
        const missing = metadata
            .map(property => property.name)
            .filter(name => name !== 'use' && !PROPERTY_CASES[name]);
        assert.deepEqual(missing, []);
    });

    for (const [name, cases] of Object.entries(PROPERTY_CASES)) {
        for (const source of cases) {
            test(`${name}: ${source.split('\n').pop()}`, () => {
                roundTrip(source);
            });
        }
    }

    for (const definition of AXIS_MANIFEST.configProperties) {
        for (const value of configCases(definition)) {
            test(`config ${definition.name}: ${value}`, () => {
                roundTrip(`config { ${definition.name}: ${value} }\ny = x`);
            });
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// What the source looks like
// ─────────────────────────────────────────────────────────────────────────────

describe('statements', () => {
    test('writes an expression with its metadata behind it', () => {
        assert.equal(
            roundTrip('y = x^2 @ color: #c74440, lineWidth: 3'),
            'y = x ^ 2 @ color: RED, lineWidth: 3\n',
        );
    });

    test('writes a note as the quoted string it was', () => {
        assert.equal(roundTrip('"Getting started"'), '"Getting started"\n');
        assert.equal(roundTrip('"a secret" @ secret'), '"a secret" @ secret\n');
    });

    test('writes a true boolean as a bare flag and a false one in full', () => {
        assert.equal(roundTrip('k = 10 @ hidden'), 'k = 10 @ hidden\n');
        assert.equal(roundTrip('k = 10 @ hidden: false'), 'k = 10 @ hidden: false\n');
    });

    test('leaves out a property the graph does not set', () => {
        assert.equal(roundTrip('y = x'), 'y = x\n');
    });

    test('has nothing to say about an empty graph', () => {
        assert.equal(fromState({}), '');
        assert.equal(roundTrip(''), '');
    });

    test('skips a row with no latex, which Desmos keeps for spacing', () => {
        assert.equal(
            fromState(
                items({ type: 'expression', id: '1' }, { type: 'expression', id: '2', latex: '' }),
            ),
            '',
        );
    });

    test('writes a long statement over lines the way the formatter would', () => {
        const source = roundTrip(
            `L = [${Array.from({ length: 40 }, (_, i) => i * 1000).join(', ')}] @ color: RED, lineWidth: 3`,
        );
        assert.ok(source.split('\n').length > 3);
    });
});

describe('colours', () => {
    test('writes a palette colour by its name', () => {
        assert.equal(roundTrip('y = x @ color: BLUE'), 'y = x @ color: BLUE\n');
    });

    test('writes any other hex as a literal', () => {
        assert.equal(roundTrip('y = x @ color: #ABC'), 'y = x @ color: #aabbcc\n');
    });

    test('writes a colour Desmos works out as the expression it is', () => {
        assert.equal(roundTrip('y = x @ color: hsv(120, 1, 1)'), 'y = x @ color: hsv(120, 1, 1)\n');
    });

    test('writes the hex of a palette name the graph defines as a literal', () => {
        // `RED` there is the variable, not the colour (spec §4.3).
        assert.equal(
            roundTrip('RED = 1\ny = x @ color: #c74440'),
            'RED = 1\ny = x @ color: #c74440\n',
        );
    });

    test('prefers the expression when a calculator hands back both keys', () => {
        // A real calculator keeps its cycled `color` beside a `colorLatex`,
        // and draws with the second.
        assert.equal(
            fromState(
                items({
                    type: 'expression',
                    id: '1',
                    latex: 'y=x',
                    color: '#2d70b3',
                    colorLatex: '\\operatorname{rgb}\\left(1,2,3\\right)',
                }),
            ),
            'y = x @ color: rgb(1, 2, 3)\n',
        );
    });
});

describe('sliders and ranges', () => {
    test('writes the bounds as a range, hard by default', () => {
        assert.equal(
            roundTrip('a = 1 @ slider: -5..5 step 0.5'),
            'a = 1 @ slider: -5..5 step 0.5\n',
        );
    });

    test('writes the end Desmos leaves off as a range left open', () => {
        assert.equal(roundTrip('a = 1 @ slider: 0..'), 'a = 1 @ slider: 0..\n');
    });

    test('writes a bound Desmos marks soft as soft', () => {
        assert.equal(roundTrip('a = 1 @ slider: 0..5 soft'), 'a = 1 @ slider: 0..5 soft\n');
        assert.equal(roundTrip('a = 1 @ slider: 0..5 soft min'), 'a = 1 @ slider: 0..5 soft min\n');
        assert.equal(roundTrip('a = 1 @ slider: 0..5 soft max'), 'a = 1 @ slider: 0..5 soft max\n');
    });

    test('reads a slider the way desmos.com saves one', () => {
        // Desmos drops the `max` that matches its own default and the
        // `hardMax` of a bound that is not a limit.
        assert.equal(
            fromState(
                items({
                    type: 'expression',
                    id: '1',
                    latex: 'a=1',
                    slider: { hardMin: true, min: '0', isPlaying: true, animationPeriod: 4000 },
                }),
            ),
            'a = 1 @ slider: 0.. soft max, playing, animationPeriod: 4000\n',
        );
    });

    test('writes an animation with no bounds as the animation alone', () => {
        assert.equal(roundTrip('a = 1 @ playing'), 'a = 1 @ playing\n');
    });

    test('writes one domain for the two keys Desmos keeps', () => {
        assert.equal(
            roundTrip('(cos(t), sin(t)) @ domain: 0..2pi'),
            '(cos(t), sin(t)) @ domain: 0..2pi\n',
        );
    });

    test('writes the older copy of a domain only where the two disagree', () => {
        const source = fromState(
            items({
                type: 'expression',
                id: '1',
                latex: '\\left(\\cos t,\\sin t\\right)',
                domain: { min: '0', max: '2\\pi' },
                parametricDomain: { min: '', max: '2\\pi' },
            }),
        );
        assert.equal(source, '(cos(t), sin(t)) @ domain: 0..2pi, parametricDomain: ..2pi\n');
        const [curve] = listOf(source) as [Expression];
        assert.deepEqual(curve.parametricDomain, { min: '', max: '2\\pi' });
    });

    test('writes `movablePointSize` only when it is not `pointSize` again', () => {
        assert.equal(roundTrip('(0, 0) @ pointSize: 14'), '(0, 0) @ pointSize: 14\n');
        assert.equal(
            roundTrip('(0, 0) @ pointSize: 14, movablePointSize: 20'),
            '(0, 0) @ pointSize: 14, movablePointSize: 20\n',
        );
    });
});

describe('clickable objects', () => {
    test('writes the action as the expression it compiles from', () => {
        assert.equal(
            roundTrip('n = 0\n(0, 0) @ onClick: n -> n + 1'),
            'n = 0\n(0, 0) @ onClick: n -> n + 1\n',
        );
    });

    test('writes `clickable: false` for a click Desmos keeps switched off', () => {
        assert.equal(
            fromState(
                items({
                    type: 'expression',
                    id: '1',
                    latex: '\\left(0,0\\right)',
                    clickableInfo: { latex: 'n\\to99' },
                }),
            ),
            '(0, 0) @ onClick: n -> 99, clickable: false\n',
        );
    });

    test('writes a run of names as a block, where its commas stay its own', () => {
        const source = roundTrip(
            'A = a -> 1\nB = b -> 2\na = 0\nb = 0\n(0, 0) @{\n    onClick: A, B\n    color: RED\n}',
        );
        assert.match(source, /\(0, 0\) @\{\n {4}color: RED\n {4}onClick: A, B\n\}/);
    });
});

describe('action runs, `with` and `for`', () => {
    test('writes a named run bare, as the spec writes it', () => {
        assert.equal(
            roundTrip('a = 0\nb = 0\nreset = a -> 0, b -> 0'),
            'a = 0\nb = 0\nreset = a -> 0, b -> 0\n',
        );
    });

    test('writes a run inside a folder bare too, since a newline separates entries', () => {
        assert.equal(
            roundTrip('folder "F" {\n    a = 0\n    reset = a -> 0, a -> 1\n}'),
            'folder "F" {\n    a = 0\n    reset = a -> 0, a -> 1\n}\n',
        );
    });

    test('writes a run of names that are actions', () => {
        assert.equal(
            roundTrip('a = 0\nA = a -> 1\nB = a -> 2\nR = A, B'),
            'a = 0\nA = a -> 1\nB = a -> 2\nR = A, B\n',
        );
    });

    test('writes `with` and `for` with their bindings', () => {
        roundTrip('f(x) = x n with n = 3');
        roundTrip('L = [i ^ 2 for i = [1...10]]');
        roundTrip('P = (i, j) for i = [1...3], j = [1...3]');
        roundTrip('folder "F" {\n    g = a - b with a = 2, b = 1\n}');
    });

    test('writes a bare run of points as the run it is', () => {
        assert.equal(roundTrip('(1, 2), (3, 4)'), '(1, 2), (3, 4)\n');
    });
});

describe('folders', () => {
    test('writes a folder around the expressions that claim it', () => {
        assert.equal(
            roundTrip('folder "Curves" {\n    y = x\n    y = 2x\n}\ny = 3x'),
            'folder "Curves" {\n    y = x\n    y = 2x\n}\n\ny = 3x\n',
        );
    });

    test('writes a folder with no title as one', () => {
        assert.equal(roundTrip('folder {\n    y = x\n}'), 'folder {\n    y = x\n}\n');
        assert.equal(roundTrip('folder "" {\n    y = x\n}'), 'folder "" {\n    y = x\n}\n');
    });

    test('writes the flags a folder carries, and only when they are set', () => {
        assert.equal(
            roundTrip('folder "A" { @ collapsed, hidden, secret\n    y = x\n}'),
            'folder "A" { @ collapsed, hidden, secret\n    y = x\n}\n',
        );
        assert.equal(
            fromState(items({ type: 'folder', id: 'f', title: 'A', collapsed: false })),
            'folder "A" {}\n',
        );
    });

    test('gathers a folder’s contents even when the list has scattered them', () => {
        const [folder, inside] = listOf('folder "F" {\n    y = x\n}');
        assert.equal(
            fromState(items(inside, folder, { type: 'expression', id: 'e', latex: 'y=2x' })),
            'folder "F" {\n    y = x\n}\n\ny = 2x\n',
        );
    });

    test('writes an expression whose folder is not there at the top level', () => {
        assert.equal(
            fromState(items({ type: 'expression', id: 'e', latex: 'y=x', folderId: 'gone' })),
            'y = x\n',
        );
    });

    test('writes an import back as the folder the reader sees', () => {
        const options = {
            path: '/main.axis',
            resolveImport: () => ({ path: '/lib.axis', source: 'y = 2x' }),
        };
        assert.equal(
            roundTrip('import "./lib.axis"', options),
            'folder "lib" { @ collapsed\n    y = 2x\n}\n',
        );
    });

    test('writes a folder inside a folder as its sibling', () => {
        assert.equal(
            fromState(
                items(
                    { type: 'folder', id: 'outer', title: 'Outer' },
                    { type: 'folder', id: 'inner', title: 'Inner', folderId: 'outer' } as never,
                    { type: 'expression', id: 'e', latex: 'y=x', folderId: 'inner' },
                ),
            ),
            'folder "Outer" {}\n\nfolder "Inner" {\n    y = x\n}\n',
        );
    });
});

describe('tables', () => {
    test('writes a column and the values under it', () => {
        assert.equal(
            roundTrip('table {\n    x = [1, 2, 3]\n    y = [2, 4, 8]\n}'),
            'table {\n    x = [1, 2, 3]\n    y = [2, 4, 8]\n}\n',
        );
    });

    test('writes a computed column, which has no values of its own', () => {
        assert.equal(
            roundTrip('table {\n    u = [-1, 0, 1]\n    u ^ 2 @ color: PURPLE\n}'),
            'table {\n    u = [-1, 0, 1]\n    u ^ 2 @ color: PURPLE\n}\n',
        );
    });

    test('writes each column’s own metadata, the table’s defaults included', () => {
        assert.equal(
            roundTrip(
                'table { @ color: GREEN, lines\n    t = [0, 1]\n    p = [0, 5] @ pointStyle: OPEN, pointSize: 12, dragMode: Y\n}',
            ),
            'table {\n    t = [0, 1] @ color: GREEN, lines\n    p = [0, 5] @ color: GREEN, pointStyle: OPEN, pointSize: 12, lines, dragMode: Y\n}\n',
        );
    });

    test('trims the blank cells Desmos pads a column with', () => {
        const table: Table = {
            type: 'table',
            id: 't',
            columns: [
                { id: 'c1', latex: 'x_{1}', values: ['1', '2', ''] },
                { id: 'c2', latex: 'y_{1}', values: ['3', '4', '5'] },
            ],
        };
        assert.equal(
            fromState(items(table)),
            'table {\n    x_1 = [1, 2]\n    y_1 = [3, 4, 5]\n}\n',
        );
    });

    test('reports a blank cell among others and keeps the rows in line', () => {
        const table: Table = {
            type: 'table',
            id: 't',
            columns: [{ id: 'c', latex: 'x', values: ['1', '', '3'] }],
        };
        const { source, diagnostics } = decompileAxis({ state: { version: 11, ...items(table) } });
        assert.deepEqual(
            diagnostics.map(d => d.code),
            ['unsupported-value'],
        );
        assert.match(source, /x = \[1, 0 \/ 0, 3\]/);
    });
});

describe('images', () => {
    const URL = 'https://example.com/a.png';

    test('writes the URL as the statement and the placement behind it', () => {
        assert.equal(
            roundTrip(`image "${URL}" @ name: "Reference", center: (1, 2), width: 4, height: 3`),
            `image "${URL}" @ name: "Reference", center: (1, 2), width: 4, height: 3\n`,
        );
    });

    test('writes a draggable image as one dragged anywhere', () => {
        assert.equal(roundTrip(`image "${URL}" @ dragMode: X`), `image "${URL}" @ dragMode: XY\n`);
        assert.equal(roundTrip(`image "${URL}" @ dragMode: NONE`), `image "${URL}"\n`);
    });

    test('writes an inlined picture as the `data:` URI the graph holds', () => {
        const image: GraphImage = {
            type: 'image',
            id: 'i',
            image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
            foreground: true,
        };
        assert.equal(
            fromState(items(image)),
            'image "data:image/gif;base64,R0lGODlhAQABAAAAACw=" @ foreground\n',
        );
    });
});

describe('the ticker', () => {
    test('writes the statement back with the properties that pace it', () => {
        assert.equal(
            roundTrip('a = 0\nticker a -> a + 1 @ minStep: 50, playing, open'),
            'a = 0\nticker a -> a + 1 @ minStep: 50, playing, open\n',
        );
    });

    test('writes `dt` as the name the handler reads it by', () => {
        assert.equal(roundTrip('t = 0\nticker t -> t + dt'), 't = 0\nticker t -> t + dt\n');
    });

    test('does not write back the `actions` a ticker switched on for itself', () => {
        assert.equal(compileAxis('a = 0\nticker a -> a + 1').options.actions, true);
        assert.equal(roundTrip('a = 0\nticker a -> a + 1').includes('config'), false);
    });

    test('keeps an `actions` the file asked for itself', () => {
        assert.equal(
            roundTrip('config { actions: false }\na = 0\nticker a -> a + 1'),
            'config {\n    actions: false\n}\n\na = 0\nticker a -> a + 1\n',
        );
    });

    test('has nothing to write for a ticker with no handler', () => {
        assert.equal(fromState({ expressions: { list: [], ticker: { playing: true } } }), '');
    });
});

describe('config', () => {
    test('writes only the settings Axis would not have applied anyway', () => {
        assert.equal(roundTrip('y = x'), 'y = x\n');
        assert.equal(
            roundTrip(`config { border: ${AXIS_DEFAULT_CONFIG.border} }\ny = x`),
            'y = x\n',
        );
    });

    test('writes each setting as its kind of value', () => {
        assert.equal(
            roundTrip(
                'config { showGrid: false; degreeMode: true; fontSize: 20; xAxisLabel: "t (s)"; xAxisArrowMode: BOTH; backgroundColor: #fafafa }\ny = x',
            ),
            'config {\n    degreeMode\n    showGrid: false\n    backgroundColor: #fafafa\n    xAxisLabel: "t (s)"\n    fontSize: 20\n    xAxisArrowMode: BOTH\n}\n\ny = x\n',
        );
    });

    test('writes the viewport edges that are not the ±10 lowering fills in', () => {
        assert.equal(
            roundTrip('config { xmin: 0; xmax: 10; squareAxes: false }\ny = x'),
            'config {\n    xmin: 0\n    squareAxes: false\n}\n\ny = x\n',
        );
    });

    test('reads a state that leaves the random-seed flag off as the legacy behaviour', () => {
        const source = decompileAxis({ state: { version: 11 } }).source;
        assert.equal(source, 'config {\n    includeFunctionParametersInRandomSeed: false\n}\n');
        assert.equal(compileAxis(source).state.includeFunctionParametersInRandomSeed, false);
    });

    test('reads the settings a calculator mirrors into the graph', () => {
        assert.equal(
            fromState({
                graph: { showGrid: false, viewport: { xmin: -5, xmax: 5, ymin: -10, ymax: 10 } },
            } as never),
            'config {\n    showGrid: false\n    xmin: -5\n    xmax: 5\n}\n',
        );
    });

    test('lets the options win over the graph where both say', () => {
        assert.equal(
            fromState({ graph: { showGrid: false } } as never, { showGrid: true }),
            'config {\n    showGrid\n}\n',
        );
    });

    test('leaves out a setting of the wrong kind or no Axis name', () => {
        assert.equal(fromState({}, { fontSize: 'large', notASetting: true }), '');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A graph written in Desmos rather than in Axis
// ─────────────────────────────────────────────────────────────────────────────

describe('what Axis cannot write', () => {
    test('reports latex it has no reading for, and carries on', () => {
        const { source, diagnostics } = decompileAxis({
            state: {
                version: 11,
                includeFunctionParametersInRandomSeed: true,
                ...items(
                    { type: 'expression', id: 'a', latex: 'y=x' },
                    { type: 'expression', id: 'b', latex: '\\sum_{n=1}^{10}n' },
                    { type: 'expression', id: 'c', latex: 'y=2x' },
                ),
            },
        });

        assert.equal(source, 'y = x\n// unsupported: \\sum_{n=1}^{10}n\ny = 2x\n');
        assert.equal(diagnostics.length, 1);
        const [diagnostic] = diagnostics;
        assert.equal(diagnostic.code, 'unsupported-latex');
        assert.equal(diagnostic.severity, 'warning');
        assert.match(diagnostic.message, /Expression b/);
        assert.equal(
            source.slice(diagnostic.span.start, diagnostic.span.end),
            '// unsupported: \\sum_{n=1}^{10}n',
        );
        assertWellFormed(source);
        assert.equal(listOf(source).length, 2);
    });

    test('drops only the property it cannot read, inside a folder too', () => {
        const { source, diagnostics } = decompileAxis({
            state: {
                version: 11,
                includeFunctionParametersInRandomSeed: true,
                ...items(
                    { type: 'folder', id: 'f', title: 'F' },
                    {
                        type: 'expression',
                        id: 'e',
                        folderId: 'f',
                        latex: 'y=x',
                        colorLatex: '\\int_{0}^{1}t',
                        lineWidth: '4',
                    },
                ),
            },
        });

        assert.equal(
            source,
            'folder "F" {\n    // unsupported color: \\int_{0}^{1}t\n    y = x @ lineWidth: 4\n}\n',
        );
        assert.equal(
            source.slice(diagnostics[0].span.start, diagnostics[0].span.end),
            '// unsupported color: \\int_{0}^{1}t',
        );
        assertWellFormed(source);
    });

    test('reports an item Axis has no statement for', () => {
        const { source, diagnostics } = decompileAxis({
            state: {
                version: 11,
                includeFunctionParametersInRandomSeed: true,
                ...items({ type: 'simulation', id: 's' } as never),
            },
        });
        assert.equal(source, '// unsupported simulation\n');
        assert.deepEqual(
            diagnostics.map(d => d.code),
            ['unsupported-item'],
        );
    });

    test('reports an enum value the manifest does not list', () => {
        const { source, diagnostics } = decompileAxis({
            state: {
                version: 11,
                includeFunctionParametersInRandomSeed: true,
                ...items({ type: 'expression', id: 'e', latex: 'y=x', lineStyle: 'WAVY' }),
            },
        });
        assert.equal(source, '// unsupported lineStyle: WAVY\ny = x\n');
        assert.deepEqual(
            diagnostics.map(d => d.code),
            ['unsupported-value'],
        );
    });
});

describe('a graph written in Desmos rather than in Axis', () => {
    test('reads a note saved without a type as a note', () => {
        assert.equal(fromState(items({ id: '1', text: 'older note' } as Note)), '"older note"\n');
    });

    test('escapes a note’s quotes and line breaks', () => {
        const source = fromState(items({ type: 'text', id: 'n', text: 'a "b"\nc' }));
        assert.equal(source, '"a \\"b\\"\\nc"\n');
        assert.equal((listOf(source)[0] as Note).text, 'a "b"\nc');
    });

    test('keeps a variable whose name closes up into a keyword a variable', () => {
        // `f_{or}` is a name Desmos is happy with, and `for` is not a name.
        const source = fromState(
            items(
                { type: 'expression', id: '1', latex: 'f_{or}=1' },
                { type: 'expression', id: '2', latex: 't_{rue}=2' },
                { type: 'expression', id: '3', latex: 'y=f_{or}x+t_{rue}' },
            ),
        );
        assert.equal(source, 'f_or = 1\nt_rue = 2\ny = f_or x + t_rue\n');
        assert.deepEqual(
            listOf(source).map(item => (item as Expression).latex),
            ['f_{or}=1', 't_{rue}=2', 'y=f_{or}x+t_{rue}'],
        );
    });

    test('reads a `with` after a definition as binding its value', () => {
        // Desmos writes it unbracketed, and means `gap` defined as the
        // substitution - not the substitution made into the definition.
        const source = fromState(
            items({ type: 'expression', id: '1', latex: 'g_{ap}=a-b\\operatorname{with}a=2,b=1' }),
        );
        assert.equal(source, 'gap = a - b with a = 2, b = 1\n');
        assert.equal(
            (listOf(source)[0] as Expression).latex,
            'g_{ap}=\\left(a-b\\operatorname{with}a=2,b=1\\right)',
        );
    });

    test('reads a point style a calculator stashed as the style it is', () => {
        // Desmos will not draw a movable point as a square, so it hands the
        // style back under a key of its own - and stashes it again when the
        // file is compiled, so reading it back is what keeps it.
        const source = fromState(
            items({
                type: 'expression',
                id: '1',
                latex: 'P=\\left(a,2\\right)',
                __stashed_V12PointStyle: 'SQUARE',
            } as Expression),
        );
        assert.equal(source, 'P = (a, 2) @ pointStyle: SQUARE\n');
    });

    test('keeps the seed of a graph that draws random numbers, and only then', () => {
        const random = items({
            type: 'expression',
            id: '1',
            latex: 'r=\\operatorname{random}\\left(\\right)',
        });
        assert.equal(
            fromState({ ...random, randomSeed: 'abc123' }),
            'config {\n    randomSeed: "abc123"\n}\n\nr = random()\n',
        );
        assert.equal(
            fromState({
                ...items({ type: 'expression', id: '1', latex: 'y=x' }),
                randomSeed: 'abc123',
            }),
            'y = x\n',
        );
    });

    test('reads latex written the way Desmos writes it', () => {
        const source = fromState(
            items(
                { type: 'expression', id: '1', latex: 'y=\\frac12x^2' },
                {
                    type: 'expression',
                    id: '2',
                    latex: 'L=\\left[1,...,10\\right]',
                    fillOpacity: '\\left[1,0.8\\right]',
                },
                { type: 'expression', id: '3', latex: 'y\\le\\sin x' },
            ),
        );
        assert.equal(
            source,
            'y = 1 / 2 x ^ 2\nL = [1...10] @ fillOpacity: [1, 0.8]\ny <= sin(x)\n',
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// One statement at a time
// ─────────────────────────────────────────────────────────────────────────────

describe('decompileExpression, decompileSettings and decompileTicker', () => {
    test('decompile one item into the statement node it is', () => {
        const [point] = listOf('(1, 2) @ color: RED, pointSize: 14');
        const { statement, diagnostics } = decompileExpression(point);
        assert.equal(statement?.kind, 'ExpressionStatement');
        assert.deepEqual(diagnostics, []);
    });

    test('decompile a folder as its header, with nothing in it', () => {
        const [folder] = listOf('folder "F" { @ collapsed\n    y = x\n}');
        const { statement } = decompileExpression(folder);
        assert.equal(statement?.kind, 'FolderStatement');
        assert.deepEqual(statement?.kind === 'FolderStatement' && statement.body, []);
    });

    test('report an item with no statement as null and a diagnostic', () => {
        const { statement, diagnostics } = decompileExpression({
            type: 'expression',
            id: 'e',
            latex: '\\prod_{n=1}^{3}n',
        });
        assert.equal(statement, null);
        assert.deepEqual(
            diagnostics.map(d => d.code),
            ['unsupported-latex'],
        );
    });

    test('decompile the settings alone, or nothing when they are the defaults', () => {
        const compiled = compileAxis('config { showGrid: false }');
        assert.equal(decompileSettings(compiled)?.entries.length, 1);
        assert.equal(decompileSettings(compileAxis('y = x')), null);
    });

    test('decompile the ticker alone', () => {
        const ticker: TickerState = { handlerLatex: 'a\\to a+1', playing: true };
        assert.equal(decompileTicker(ticker).statement?.kind, 'TickerStatement');
        assert.equal(decompileTicker({ playing: true }).statement, null);
    });
});
