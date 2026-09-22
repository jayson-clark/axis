// ═════════════════════════════════════════════════════════════════════════════
// Compiling a script into one graph state
// ═════════════════════════════════════════════════════════════════════════════
//
// What `compileAxis` hands a host (spec §9): a state `setState` takes whole,
// the options `updateSettings` takes after it, and everything it had to say.
// Every behaviour v1's compiler had that Desmos depends on is pinned here in v2
// syntax - the setState forms, keys left off rather than written `false`, the
// viewport and the flags a host no longer adds for itself. Whether Desmos then
// accepts the result is the harness's question; this is the fast half.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    DesmosExpression,
    Expression,
    Folder,
    GraphImage,
    Note,
    Table,
} from '@axis-dsl/desmos';
import { AXIS_DEFAULT_CONFIG, AXIS_DEFAULT_STATE } from '@axis-dsl/syntax';
import { imageMediaType } from '@axis-dsl/language';
import { codes, compileAxis, compileWith, listOf, only } from './support/compile.mts';

/**
 * A compilation without its source map: the graph it describes, and nothing
 * about where it was written. Two layouts of one script build the same graph,
 * but they are written on different lines, and should say so.
 */
const graphOf = (source: string) => {
    const { sourceMap, configOrigin, ...graph } = compileAxis(source);
    void sourceMap;
    void configOrigin;
    return graph;
};

describe('the state', () => {
    test('is a whole graph state, the expression list in it', () => {
        const { state } = compileAxis('y = x\ny = 2x');

        assert.equal(state.version, 11);
        assert.deepEqual(
            state.expressions?.list?.map(item => (item as Expression).latex),
            ['y=x', 'y=2x'],
        );
    });

    test('opens a script with no viewport at the default framing', () => {
        const { state } = compileAxis('y = x');
        assert.deepEqual(state.graph?.viewport, { xmin: -10, ymin: -10, xmax: 10, ymax: 10 });
    });

    test('completes a viewport given in part rather than dropping it', () => {
        // Desmos ignores a half-written rectangle, so the edges the script left
        // out have to come from somewhere.
        const { state } = compileAxis('config { xmin: 0; squareAxes: false }');

        assert.deepEqual(state.graph?.viewport, { xmin: 0, ymin: -10, xmax: 10, ymax: 10 });
        assert.equal(state.graph?.squareAxes, false);
    });

    test('carries the ticker beside the list, and only when there is one', () => {
        assert.ok(!('ticker' in compileAxis('y = x').state.expressions!));
        assert.ok(compileAxis('a = 0\nticker a -> a + 1').state.expressions?.ticker);
    });

    test('keeps a movable point in the style the script gave it', () => {
        assert.equal(compileAxis('y = x').state.doNotMigrateMovablePointStyle, true);
    });

    test('carries the top-level flags, defaults included', () => {
        const { state } = compileAxis('y = x');
        assert.equal(
            state.includeFunctionParametersInRandomSeed,
            AXIS_DEFAULT_STATE.includeFunctionParametersInRandomSeed,
        );
        assert.equal(
            compileAxis('config { includeFunctionParametersInRandomSeed: false }').state
                .includeFunctionParametersInRandomSeed,
            false,
        );
    });
});

describe('expressions', () => {
    test('compiles one statement into one expression', () => {
        const expression = only<Expression>('y = x^2');
        assert.equal(expression.type, 'expression');
        assert.equal(expression.latex, 'y=x^{2}');
    });

    test('skips blank lines and comments', () => {
        assert.deepEqual(
            listOf('// a comment\n\ny = x\n').map(item => (item as Expression).latex),
            ['y=x'],
        );
    });

    test('gives every item a distinct id, the same every time', () => {
        const source = 'y = x\nfolder "F" { z = 1 }\ntable { x = [1]; y = [2] }\n"n"';
        const ids = listOf(source).map(item => item.id);

        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual(
            listOf(source).map(item => item.id),
            ids,
        );
    });

    test('leaves a property the script never set off the expression entirely', () => {
        // Not `undefined` under the key: Desmos reads the key as present and
        // decides nothing for itself, so a point handed `dragMode: undefined`
        // arrives frozen rather than draggable.
        assert.deepEqual(Object.keys(only<Expression>('(1, 2)')), ['type', 'id', 'latex']);

        for (const source of [
            '(1, 2)',
            '"a note"',
            'folder "F" { y = x }',
            'folder { y = x }',
            'table { x = [1, 2] }',
            'image "https://example.com/a.png"',
        ]) {
            const undefinedKeys = (items: object[]): string[] =>
                items.flatMap(item =>
                    Object.entries(item).flatMap(([key, value]) =>
                        value === undefined
                            ? [key]
                            : Array.isArray(value)
                              ? undefinedKeys(value.filter(v => typeof v === 'object'))
                              : [],
                    ),
                );
            assert.deepEqual(undefinedKeys(listOf(source)), [], source);
        }
    });

    test('writes a run of named actions bare, since a bracketed one is a point', () => {
        const [, , run] = listOf('A = a -> 1\nB = b -> 2\nR = A, B') as Expression[];
        assert.equal(run.latex, 'R=A,B');
        assert.equal(only<Expression>('R = a -> 1, b -> 2').latex, 'R=a\\to1,b\\to2');
    });
});

describe('notes', () => {
    test('compile a bare string into a note', () => {
        const note = only<Note>('"Getting started"');
        assert.equal(note.type, 'text');
        assert.equal(note.text, 'Getting started');
    });

    test('carry secret, and nothing when it is not set', () => {
        assert.equal(only<Note & { secret?: boolean }>('"a" @ secret').secret, true);
        assert.ok(!('secret' in only<Note>('"a"')));
    });
});

describe('folders', () => {
    test('hold what is written inside them', () => {
        const [folder, child, after] = listOf('folder "Curves" {\n    y = x\n}\nz = 1') as [
            Folder,
            Expression,
            Expression,
        ];
        assert.equal(folder.title, 'Curves');
        assert.equal(child.folderId, folder.id);
        assert.equal(after.folderId, undefined);
    });

    test('read their own metadata from straight after the brace', () => {
        const folder = listOf(
            'folder "A" { @ collapsed, hidden, secret\n    y = x\n}',
        )[0] as Folder;
        assert.deepEqual([folder.collapsed, folder.hidden, folder.secret], [true, true, true]);
    });

    test('say "not collapsed" by leaving the key off', () => {
        const folder = listOf('folder "A" { @ collapsed: false\n    y = x\n}')[0];
        assert.ok(!('collapsed' in folder));
    });

    test('need no title (#10)', () => {
        // Desmos stores an untitled folder with no title at all, not an empty one.
        const [folder, child] = listOf('folder { y = x }') as [Folder, Expression];
        assert.equal(folder.type, 'folder');
        assert.ok(!('title' in folder));
        assert.equal(child.folderId, folder.id);
    });

    test('put a folder written inside one into the one outside it', () => {
        // An error, reported - and the graph still gets the contents.
        const source = 'folder "A" {\n    folder "B" { y = x }\n}';
        const [outer, inner] = listOf(source) as [Folder, Expression];
        assert.deepEqual(codes(source), ['nested-folder']);
        assert.equal(inner.folderId, outer.id);
    });
});

describe('tables', () => {
    test('compile columns of values and computed columns', () => {
        const table = only<Table>('table { x = [1, 2, 3]; x ^ 2 }');
        assert.equal(table.type, 'table');
        assert.deepEqual(
            table.columns.map(column => [column.latex, column.values]),
            [
                ['x', ['1', '2', '3']],
                ['x^{2}', []],
            ],
        );
    });

    test('write each value as latex', () => {
        const table = only<Table>('table { x = [-1, 1 / 2, pi] }');
        assert.deepEqual(table.columns[0].values, ['-1', '\\frac{1}{2}', '\\pi']);
    });

    test('compile the same written out as written inline', () => {
        assert.deepEqual(
            graphOf('table { x = [1, 2]; y = [1, 4] }'),
            graphOf('table {\n    x = [1, 2]\n    y = [1, 4]\n}'),
        );
    });

    test('take table metadata as each column’s default, which a column overrides', () => {
        const table = only<Table>(
            'table { @ color: RED, lineStyle: DASHED\n    x = [1, 2]\n    y = [3, 4] @ color: BLUE\n}',
        );
        assert.equal(table.columns[0].color, '#c74440');
        assert.equal(table.columns[1].color, '#2d70b3');
        assert.equal(table.columns[1].lineStyle, 'DASHED');
    });

    test('give a column colour as an expression as colorLatex', () => {
        const table = only<Table>('table { x = [1]; y = [2] @ color: rgb(1, 2, 3) }');
        assert.equal(
            (table.columns[1] as { colorLatex?: string }).colorLatex,
            '\\operatorname{rgb}\\left(1,2,3\\right)',
        );
    });

    test('size a column’s movable points as its points', () => {
        const table = only<Table>('table { x = [1]; y = [2] @ pointSize: 12 }');
        assert.equal(table.columns[1].movablePointSize, '12');
    });
});

describe('config', () => {
    test('goes to the options, over the Axis defaults', () => {
        const { options } = compileAxis('config {\n    showGrid: true\n    fontSize: 16\n}');
        assert.deepEqual(options, { ...AXIS_DEFAULT_CONFIG, showGrid: true, fontSize: 16 });
    });

    test('is the Axis defaults for a script with none', () => {
        assert.deepEqual(compileAxis('y = x').options, AXIS_DEFAULT_CONFIG);
    });

    test('overrides an Axis default', () => {
        assert.equal(compileAxis('config { expressions: false }').options.expressions, false);
    });

    test('puts the viewport and the graph keys in the state, not the options', () => {
        // `updateSettings({ xmin: 0 })` is not an error, it is nothing at all.
        const { options, state } = compileAxis(
            'config { xmin: -1; xmax: 6; ymin: -5; ymax: 25; squareAxes: false; userLockedViewport }',
        );
        assert.deepEqual(state.graph?.viewport, { xmin: -1, xmax: 6, ymin: -5, ymax: 25 });
        assert.equal(state.graph?.squareAxes, false);
        assert.equal(state.graph?.userLockedViewport, true);
        for (const key of ['xmin', 'squareAxes', 'userLockedViewport']) {
            assert.ok(!(key in options), key);
        }
    });

    test('reads each entry as the type it is', () => {
        const { options } = compileAxis(
            'config {\n    xAxisLabel: "time"\n    xAxisArrowMode: positive\n    backgroundColor: #fff\n    textColor: BLUE\n    xAxisStep: -2\n    trace\n}',
        );
        assert.equal(options.xAxisLabel, 'time');
        assert.equal(options.xAxisArrowMode, 'POSITIVE');
        assert.equal(options.backgroundColor, '#ffffff');
        assert.equal(options.textColor, '#2d70b3');
        assert.equal(options.xAxisStep, -2);
        assert.equal(options.trace, true);
    });

    test('takes `actions` as a boolean, or `auto`', () => {
        assert.equal(compileAxis('config { actions: true }').options.actions, true);
        assert.equal(compileAxis('config { actions: auto }').options.actions, 'auto');
    });

    test('emits no expression', () => {
        assert.deepEqual(listOf('config { showGrid: true }'), []);
    });

    test('says where the entry script wrote it', () => {
        const { configOrigin } = compileAxis('y = x\nconfig {\n    showGrid: true\n}');
        assert.equal(configOrigin?.line, 1);
        assert.equal(configOrigin?.endLine, 3);
        assert.equal(compileAxis('y = x').configOrigin, undefined);
    });
});

describe('the ticker', () => {
    test('compiles into the ticker the state carries', () => {
        const { state } = compileAxis('a = 0\nticker a -> a + 1 @ minStep: 50, playing');
        assert.deepEqual(state.expressions?.ticker, {
            handlerLatex: 'a\\to a+1',
            minStepLatex: '50',
            playing: true,
        });
    });

    test('writes `dt` as the one spelling Desmos knows (#11)', () => {
        const { state } = compileAxis('t = 0\nticker t -> t + dt');
        assert.equal(state.expressions?.ticker?.handlerLatex, 't\\to t+\\operatorname{dt}');
    });

    test('runs several actions at once, written bare', () => {
        const { state } = compileAxis('ticker a -> a + 1, b -> b - 1');
        assert.equal(state.expressions?.ticker?.handlerLatex, 'a\\to a+1,b\\to b-1');
    });

    test('says "not playing" and "not open" by leaving them off', () => {
        const ticker = compileAxis('ticker a -> a + 1 @ playing: false').state.expressions?.ticker;
        assert.deepEqual(ticker, { handlerLatex: 'a\\to a+1' });
    });

    test('emits no expression - a ticker is not in the list', () => {
        assert.deepEqual(listOf('ticker a -> a + 1'), []);
    });

    test('switches actions on, since `auto` cannot see a ticker', () => {
        assert.deepEqual(compileAxis('ticker a -> a + 1').options, {
            ...AXIS_DEFAULT_CONFIG,
            actions: true,
        });
        assert.equal(
            compileAxis('config { actions: false }\nticker a -> a + 1').options.actions,
            false,
        );
    });

    test('the entry script’s wins over an imported one', () => {
        const { state } = compileWith('import "lib"\nticker b -> b + 1', {
            '/lib.axis': 'ticker a -> a + 1',
        });
        assert.equal(state.expressions?.ticker?.handlerLatex, 'b\\to b+1');
    });

    test('an imported one applies when the entry has none', () => {
        const { state } = compileWith('import "lib"', { '/lib.axis': 'ticker a -> a + 1' });
        assert.equal(state.expressions?.ticker?.handlerLatex, 'a\\to a+1');
    });

    test('one misplaced in a folder never overrides the real one', () => {
        const { state } = compileAxis('folder "F" { ticker a -> 1 }\nticker b -> 2');
        assert.equal(state.expressions?.ticker?.handlerLatex, 'b\\to2');
    });
});

describe('metadata', () => {
    test('applies styling, enums in whatever case they are written', () => {
        const expression = only<Expression>('y = x @ color: #c74440, lineStyle: dashed');
        assert.equal(expression.color, '#c74440');
        assert.equal(expression.lineStyle, 'DASHED');
        assert.equal(
            only<Expression>('(1, 2) @ label: "a", labelOrientation: ABOVE_LEFT').labelOrientation,
            'above_left',
        );
    });

    test('writes a property Desmos holds as latex as latex', () => {
        const expression = only<Expression>('y = x @ lineWidth: w + 1, lineOpacity: 0.5');
        assert.equal(expression.lineWidth, 'w+1');
        assert.equal(expression.lineOpacity, '0.5');
    });

    test('reads a bare flag as true, and a written false as false', () => {
        const flags = only<Expression>('y = x @ hidden, secret, lines: false');
        assert.equal(flags.hidden, true);
        assert.equal(flags.secret, true);
        assert.equal(flags.lines, false);
    });

    test('keeps a string a string', () => {
        assert.equal(only<Expression>('(0, 0) @ label: "42"').label, '42');
        assert.equal(only<Expression>('(0, 0) @ description: "true"').description, 'true');
    });

    test('sizes a movable point the same as a fixed one, unless told otherwise', () => {
        // Desmos sizes a movable point from `movablePointSize` alone, so a
        // point would change size the moment it turned out to be draggable.
        const point = only<Expression>('(a, 1) @ pointSize: 20');
        assert.equal(point.movablePointSize, '20');
        assert.equal(
            only<Expression>('(a, 1) @ pointSize: 20, movablePointSize: 9').movablePointSize,
            '9',
        );
    });

    test('turns onClick into clickableInfo', () => {
        assert.deepEqual(only<Expression>('(1, 2) @ onClick: a -> a + 1').clickableInfo, {
            enabled: true,
            latex: 'a\\to a+1',
        });
        assert.deepEqual(
            only<Expression>('(1, 2) @ onClick: a -> 1, b -> 2, color: RED').clickableInfo?.latex,
            'a\\to1,b\\to2',
        );
    });

    test('switches a clickable off by leaving `enabled` off', () => {
        const clickable = only<Expression>(
            '(1, 2) @ onClick: a -> 1, clickable: false',
        ).clickableInfo;
        assert.deepEqual(clickable, { latex: 'a\\to1' });
    });

    test('makes an object clickable with no action', () => {
        assert.deepEqual(only<Expression>('(1, 2) @ clickable').clickableInfo, {
            enabled: true,
            latex: '',
        });
    });
});

describe('sliders', () => {
    test('compile to `slider`, with hard latex bounds', () => {
        // Not `sliderBounds`: that is what `setExpression` takes, and nothing
        // applies expressions that way.
        assert.deepEqual(only<Expression>('a = 1 @ slider: 0..10 step 0.1').slider, {
            min: '0',
            max: '10',
            hardMin: true,
            hardMax: true,
            step: '0.1',
        });
    });

    test('soften both ends, or one, by leaving the flag off', () => {
        assert.deepEqual(only<Expression>('a = 1 @ slider: 0..10 soft').slider, {
            min: '0',
            max: '10',
        });
        assert.deepEqual(only<Expression>('a = 1 @ slider: 0..10 soft min').slider, {
            min: '0',
            max: '10',
            hardMax: true,
        });
        assert.deepEqual(only<Expression>('a = 1 @ slider: 0..10 soft max').slider, {
            min: '0',
            max: '10',
            hardMin: true,
        });
    });

    test('leave an end the script left off to Desmos', () => {
        assert.deepEqual(only<Expression>('a = 1 @ slider: 0.. step 1').slider, {
            min: '0',
            hardMin: true,
            hardMax: true,
            step: '1',
        });
    });

    test('take any expression for an end or a step', () => {
        assert.deepEqual(only<Expression>('a = 1 @ slider: -m..m step m / 10').slider, {
            min: '-m',
            max: 'm',
            hardMin: true,
            hardMax: true,
            step: '\\frac{m}{10}',
        });
    });

    test('animate, with or without a range', () => {
        assert.deepEqual(only<Expression>('a = 1 @ playing').slider, { isPlaying: true });
        assert.deepEqual(
            only<Expression>(
                'a = 1 @ slider: 0..1, playing, loopMode: play_once, playDirection: -1, animationPeriod: 4000',
            ).slider,
            {
                min: '0',
                max: '1',
                hardMin: true,
                hardMax: true,
                isPlaying: true,
                loopMode: 'PLAY_ONCE',
                playDirection: -1,
                animationPeriod: 4000,
            },
        );
    });
});

describe('domains', () => {
    test('set `domain` and `parametricDomain` both', () => {
        const curve = only<Expression>('(cos(t), sin(t)) @ domain: 0..2pi');
        assert.deepEqual(curve.domain, { min: '0', max: '2\\pi' });
        assert.deepEqual(curve.parametricDomain, { min: '0', max: '2\\pi' });
    });

    test('let `parametricDomain` differ when written', () => {
        const curve = only<Expression>('(cos(t), sin(t)) @ domain: 0..1, parametricDomain: 0..2');
        assert.deepEqual(curve.parametricDomain, { min: '0', max: '2' });
    });

    test('write an end left off as the empty string Desmos stores', () => {
        assert.deepEqual(only<Expression>('r = theta @ polarDomain: ..4pi').polarDomain, {
            min: '',
            max: '4\\pi',
        });
    });
});

describe('colours (#2)', () => {
    test('a hex literal is `color`, written out in full', () => {
        assert.equal(only<Expression>('y = x @ color: #C74440').color, '#c74440');
        assert.equal(only<Expression>('y = x @ color: #abc').color, '#aabbcc');
    });

    test('a palette name is its hex', () => {
        assert.equal(only<Expression>('y = x @ color: ORANGE').color, '#fa7e19');
    });

    test('anything else is an expression, `colorLatex`', () => {
        const [, line] = listOf('c = rgb(1, 2, 3)\ny = x @ color: c') as Expression[];
        assert.equal(line.colorLatex, 'c');
        assert.ok(!('color' in line));
        assert.equal(
            only<Expression>('y = x @ color: hsv(h, 1, 1)').colorLatex,
            '\\operatorname{hsv}\\left(h,1,1\\right)',
        );
    });

    test('a palette name in the wrong case is left off, not drawn as r·e·d', () => {
        const line = only<Expression>('y = x @ color: red');
        assert.ok(!('colorLatex' in line));
        assert.ok(!('color' in line));
    });

    test('unless the script defines that name, when it is the variable', () => {
        const [, line] = listOf('red = rgb(255, 0, 0)\ny = x @ color: red') as Expression[];
        assert.equal(line.colorLatex, 'r_{ed}');
    });
});

describe('images', () => {
    const URL = 'https://example.com/a.png';

    test('place a picture, every measurement latex', () => {
        const image = only<GraphImage>(
            `image "${URL}" @ name: "A", center: (x0, 2), width: 10 * s, height: 3, angle: -pi / 200, opacity: 0.5`,
        );
        assert.equal(image.type, 'image');
        assert.equal(image.image_url, URL);
        assert.equal(image.name, 'A');
        assert.equal(image.center, '\\left(x_{0},2\\right)');
        assert.equal(image.width, '10\\cdot s');
        assert.equal(image.height, '3');
        // A sign binds tighter than a division (spec §5.1), so this is (-π)/200.
        assert.equal(image.angle, '\\frac{-\\pi}{200}');
        assert.equal(image.opacity, '0.5');
    });

    test('carry the flags an image shares with a statement', () => {
        const image = only<GraphImage>(`image "${URL}" @ foreground, hidden, secret`);
        assert.deepEqual([image.foreground, image.hidden, image.secret], [true, true, true]);
    });

    test('are dragged with `draggable`, the key Desmos keeps for an image', () => {
        // Desmos ignores `dragMode` on an image; it has a flag of its own.
        const image = only<GraphImage & { draggable?: boolean }>(`image "${URL}" @ dragMode: XY`);
        assert.equal(image.draggable, true);
        assert.ok(!('dragMode' in image));
        assert.ok(!('draggable' in only<GraphImage>(`image "${URL}" @ dragMode: NONE`)));
    });

    test('take a click like any other object', () => {
        const image = only<GraphImage>(`image "${URL}" @ onClick: n -> n + 1`);
        assert.deepEqual(image.clickableInfo, { enabled: true, latex: 'n\\to n+1' });
    });
});

describe('the source map', () => {
    test('traces every item to the statement that made it', () => {
        const source =
            '"note"\nfolder "F" {\n    y = x @{\n        color: RED\n    }\n}\ntable { x = [1] }';
        const { state, sourceMap } = compileAxis(source);
        const list = state.expressions?.list ?? [];

        assert.equal(sourceMap.size, list.length);
        const [note, folder, curve, table] = list.map(item => sourceMap.get(item.id!)!);
        assert.deepEqual([note.line, note.endLine], [0, 0]);
        assert.deepEqual([folder.line, folder.endLine], [1, 5]);
        assert.deepEqual([curve.line, curve.endLine], [2, 4]);
        assert.equal(
            source.slice(curve.span.start, curve.span.end),
            'y = x @{\n        color: RED\n    }',
        );
        assert.deepEqual([table.line, table.endLine], [6, 6]);
    });

    test('tells two statements on one line apart by their characters', () => {
        const source = 'a = 1; b = 2';
        const { state, sourceMap } = compileAxis(source);
        const [a, b] = (state.expressions?.list ?? []).map(item => sourceMap.get(item.id!)!);

        assert.equal(source.slice(a.span.start, a.span.end), 'a = 1');
        assert.equal(source.slice(b.span.start, b.span.end), 'b = 2');
        assert.ok(a.writable && b.writable);
    });

    test('traces an imported statement to the file it was written in', () => {
        const { state, sourceMap } = compileWith('import "./lib"', { '/lib.axis': '\ny = x' });
        const [folder, curve] = (state.expressions?.list ?? []).map(item =>
            sourceMap.get(item.id!)!,
        );

        assert.equal(folder.path, '/main.axis');
        assert.equal(curve.path, '/lib.axis');
        assert.equal(curve.line, 1);
    });

    test('marks a statement a macro expanded into as not writable', () => {
        const { state, sourceMap } = compileAxis(
            'macro TAU = 6.28\ny = TAU\ny = x @ lineWidth: TAU\ny = 2',
        );
        const [expanded, inMetadata, plain] = (state.expressions?.list ?? []).map(item =>
            sourceMap.get(item.id!)!,
        );

        assert.equal(expanded.writable, false);
        assert.match(expanded.reason ?? '', /macro/);
        assert.equal(inMetadata.writable, false);
        assert.equal(plain.writable, true);
    });

    test('leaves a statement that used a style writable', () => {
        // The `use:` is itself source, and writing the statement writes it back.
        const { state, sourceMap } = compileAxis('style s { color: RED }\ny = x @ use: s');
        const [curve] = state.expressions?.list ?? [];
        assert.equal(sourceMap.get(curve.id!)?.writable, true);
    });
});

describe('a script with mistakes in it', () => {
    test('never throws, whatever it is handed', () => {
        for (const source of [
            'y = ',
            ')',
            '@ color: RED',
            'folder {',
            'table { x = [1, }',
            'y = "string"',
            'image',
            'import',
            'ticker',
            'macro',
            'style {',
            'config { a: }',
            '#ff00',
            'y = x @ color: ',
            'a = 1 @ slider: ..',
            '\u0000\u0001',
            'macro A = A\ny = A',
            'macro A(x) = B(x)\nmacro B(x) = A(x)\ny = A(1)',
            'style a { use: a }\ny = x @ use: a',
        ]) {
            assert.doesNotThrow(() => compileAxis(source), source);
        }
    });

    test('still graphs everything else', () => {
        const { state, diagnostics } = compileAxis(
            'y = x\ny = notAFunction(x, 2)\ny = 2x @ color: red',
        );
        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['unknown-function', 'invalid-color'],
        );
        assert.deepEqual(
            state.expressions?.list?.map(item => (item as Expression).latex),
            ['y=x', 'y=n_{otAFunction}\\left(x,2\\right)', 'y=2x'],
        );
    });

    test('leaves out what cannot be written, and keeps the rest', () => {
        const { state } = compileAxis('y = x\ny = "str"\ny = 2');
        assert.deepEqual(
            state.expressions?.list?.map(item => (item as Expression).latex),
            ['y=x', 'y=2'],
        );
    });
});

describe('layout', () => {
    test('a block written inline compiles the same as one written out', () => {
        assert.deepEqual(
            graphOf('folder "A" { y = x; z = 1 }'),
            graphOf('folder "A" {\n    y = x\n    z = 1\n}'),
        );
        assert.deepEqual(
            graphOf('config { showGrid: false; degreeMode: true }'),
            graphOf('config {\n    showGrid: false\n    degreeMode: true\n}'),
        );
    });

    test('an @{ } block compiles the same as the inline run', () => {
        assert.deepEqual(
            graphOf('y = x @ color: #c74440, lineWidth: 3, lineStyle: DASHED'),
            graphOf('y = x @{\n    color: #c74440\n    lineWidth: 3\n    lineStyle: DASHED\n}'),
        );
    });

    test('a statement split across a bracket is one statement', () => {
        assert.equal(
            only<Expression>('P = [\n    (0, 0),\n    (4, 0)\n]').latex,
            'P=\\left[\\left(0,0\\right),\\left(4,0\\right)\\right]',
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Every example compiles cleanly
// ═════════════════════════════════════════════════════════════════════════════
//
// The examples are the widest use of the language there is. The harness runs
// them through a calculator; here they have only to compile without a word.

describe('the example scripts', () => {
    const directory = fileURLToPath(new URL('../../../examples/scripts/', import.meta.url));

    const resolveImport = (specifier: string, from: string) => {
        const target = specifier.endsWith('.axis') ? specifier : `${specifier}.axis`;
        const path = target.startsWith('/')
            ? resolve(directory, target.slice(1))
            : resolve(dirname(from), target);
        return { path, source: readFileSync(path, 'utf8') };
    };

    const resolveImage = (url: string, from: string) => {
        const path = url.startsWith('/')
            ? resolve(directory, url.slice(1))
            : resolve(dirname(from), url);
        const data = readFileSync(path).toString('base64');
        return { path, dataUri: `data:${imageMediaType(path)};base64,${data}` };
    };

    for (const name of readdirSync(directory).filter(file => file.endsWith('.axis'))) {
        test(`${name} compiles with nothing to report`, () => {
            const path = resolve(directory, name);
            const result = compileAxis(readFileSync(path, 'utf8'), {
                path,
                resolveImport,
                resolveImage,
            });

            assert.deepEqual(result.diagnostics, []);
            assert.ok((result.state.expressions?.list ?? []).length > 0);
            const ids = (result.state.expressions?.list ?? []).map(
                (item: DesmosExpression) => item.id,
            );
            assert.deepEqual([...result.sourceMap.keys()].sort(), [...ids].sort());
        });
    }
});
