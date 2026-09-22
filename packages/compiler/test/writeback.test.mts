// ═════════════════════════════════════════════════════════════════════════════
// A changed graph, back into the script that built it
// ═════════════════════════════════════════════════════════════════════════════
//
// What the cases below are really about is what survives. Any of them could be
// made to pass by decompiling the whole graph and writing the file out again -
// and every one of them would then be testing nothing, because the comments,
// the blank lines, the macros, the styles and the layout the author chose would
// be gone.
//
// So each test changes something and then asserts on the whole file: the
// statement that changed, and that everything around it is exactly what it
// was. Most compare the written script as a string for that reason.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applySourceEdits, compileAxis, diffGraphs, writeBackGraph } from '../dist/index.js';
import type {
    CompilationResult,
    CompileOptions,
    GraphSnapshot,
    WriteBackOptions,
} from '../dist/index.js';

const PATH = 'main.axis';

type Item = Record<string, unknown>;

/** The graph a compilation builds, as a calculator holding it would read. */
function snapshot(compiled: CompilationResult): GraphSnapshot {
    // Deep-copied, so a test that edits one reading is not also editing the
    // other or the compilation.
    return { state: structuredClone(compiled.state), options: structuredClone(compiled.options) };
}

/** Compile a script and take the graph it built twice: as it was, and to change. */
function open(source: string, options: CompileOptions = {}) {
    const compiled = compileAxis(source, { path: PATH, ...options });
    return { source, compiled, before: snapshot(compiled), after: snapshot(compiled) };
}

type Opened = ReturnType<typeof open>;

/** Write the change back and apply it, returning the new script and the report. */
function write({ source, compiled, before, after }: Opened, options: WriteBackOptions = {}) {
    const result = writeBackGraph(source, { before, after }, compiled, options);
    return { ...result, source: applySourceEdits(source, result.edits) };
}

/** The item with this id in a reading - the thing a test changes. */
function item(snapshot: GraphSnapshot, id: string): Item {
    const found = list(snapshot).find(candidate => candidate.id === id);
    assert.ok(found, `no expression ${id}`);
    return found as Item;
}

function list(snapshot: GraphSnapshot): Item[] {
    return (snapshot.state.expressions?.list ?? []) as unknown as Item[];
}

function remove(snapshot: GraphSnapshot, id: string) {
    snapshot.state.expressions!.list = snapshot.state.expressions!.list!.filter(e => e.id !== id);
}

/**
 * The property this whole feature rests on: the script written back compiles
 * to the graph the calculator is showing.
 */
function reproduces(opened: Opened, written: string, options: CompileOptions = {}) {
    const recompiled = compileAxis(written, { path: PATH, ...options });
    assert.deepEqual(
        recompiled.diagnostics.filter(d => d.severity === 'error'),
        [],
        'the written script has errors',
    );
    assert.deepEqual(recompiled.state.expressions, opened.after.state.expressions);
}

describe('what changed', () => {
    test('sees a point that moved, and nothing else', () => {
        const { before, after } = open('y = x^2\nP = (1, 2)\nQ = (3, 4)');
        item(after, 'expr_2').latex = 'P=\\left(1.5,2.5\\right)';

        assert.deepEqual(
            diffGraphs(before, after).map(change => [change.kind, change.id]),
            [['changed', 'expr_2']],
        );
    });

    test('is not fooled by a state whose keys came back in another order', () => {
        const { before, after } = open('y = x @ color: RED, lineWidth: 3');
        const { latex, id, type, ...rest } = item(after, 'expr_1');
        after.state.expressions!.list![0] = { id, ...rest, type, latex } as never;

        assert.deepEqual(diffGraphs(before, after), []);
    });

    test('sees an expression added and one removed', () => {
        const { before, after } = open('y = x');
        after.state.expressions!.list!.push({ type: 'expression', id: '7', latex: 'z=3' });
        remove(after, 'expr_1');

        assert.deepEqual(
            diffGraphs(before, after)
                .map(change => change.kind)
                .sort(),
            ['added', 'removed'],
        );
    });

    test('sees the viewport move, and a setting change', () => {
        const { before, after } = open('y = x');
        after.state.graph = { viewport: { xmin: -20, xmax: 20, ymin: -20, ymax: 20 } };
        assert.deepEqual(
            diffGraphs(before, after).map(change => change.kind),
            ['settings'],
        );

        const other = open('y = x');
        other.after.options = { ...other.after.options, showGrid: false };
        assert.deepEqual(
            diffGraphs(other.before, other.after).map(change => change.kind),
            ['settings'],
        );
    });

    test('sees the ticker change', () => {
        const { before, after } = open('ticker a -> a + 1\na = 0');
        after.state.expressions!.ticker!.minStepLatex = '100';
        assert.deepEqual(
            diffGraphs(before, after).map(change => change.kind),
            ['ticker'],
        );
    });

    test('ignores an option no config property reads', () => {
        const { before, after } = open('y = x');
        after.options = { ...after.options, guid: 'something else' } as never;
        assert.deepEqual(diffGraphs(before, after), []);
    });
});

describe('writing one statement back', () => {
    test('rewrites the statement a dragged point came from, and nothing else', () => {
        const opened = open(
            [
                '// The parabola, which nobody dragged',
                'y = x^2',
                '',
                '// The point, which somebody did',
                'P = (1, 2)',
            ].join('\n'),
        );
        item(opened.after, 'expr_2').latex = 'P=\\left(1.5,2.5\\right)';

        const { source, skipped } = write(opened);

        assert.deepEqual(skipped, []);
        assert.equal(
            source,
            [
                '// The parabola, which nobody dragged',
                'y = x^2',
                '',
                '// The point, which somebody did',
                'P = (1.5, 2.5)',
            ].join('\n'),
        );
        reproduces(opened, source);
    });

    test('keeps the comment on the end of the line it rewrites', () => {
        const opened = open('P = (1, 2) @ dragMode: XY // the anchor');
        item(opened.after, 'expr_1').latex = 'P=\\left(9,9\\right)';

        assert.equal(write(opened).source, 'P = (9, 9) @ dragMode: XY // the anchor');
    });

    test('keeps the indentation of a statement inside a folder', () => {
        const opened = open('folder "Points" {\n  P = (1, 2)\n  Q = (3, 4)\n}');
        item(opened.after, 'expr_2').latex = 'P=\\left(5,6\\right)';

        assert.equal(write(opened).source, 'folder "Points" {\n  P = (5, 6)\n  Q = (3, 4)\n}');
    });

    test('keeps the parts of an expression the graph did not change as they were written', () => {
        // The author's brackets, their `*`, their `0.50`: the calculator's
        // latex has none of these, and only the number that moved should.
        const opened = open('y = 2 * (x + 1)^2 + 0.50');
        item(opened.after, 'expr_1').latex = 'y=2\\cdot\\left(x+1\\right)^{2}+3';

        assert.equal(write(opened).source, 'y = 2 * (x + 1) ^ 2 + 3');
    });

    test("keeps the author's spelling of a point it moved one coordinate of", () => {
        const opened = open('P = (a/2, 0.50) @ dragMode: Y');
        item(opened.after, 'expr_1').latex = 'P=\\left(\\frac{a}{2},4\\right)';

        assert.equal(write(opened).source, 'P = (a / 2, 4) @ dragMode: Y');
    });

    test('writes a recolour as the palette name Desmos picked it from', () => {
        const opened = open('y = x^2 @ color: RED, lineWidth: 3');
        item(opened.after, 'expr_1').color = '#2d70b3';

        const { source } = write(opened);
        assert.equal(source, 'y = x ^ 2 @ color: BLUE, lineWidth: 3');
        reproduces(opened, source);
    });

    test('writes any other colour as a hex literal', () => {
        const opened = open('y = x @ lineWidth: 3');
        item(opened.after, 'expr_1').color = '#123456';

        const { source } = write(opened);
        assert.equal(source, 'y = x @ lineWidth: 3, color: #123456');
        reproduces(opened, source);
    });

    test('keeps the metadata in the order the author wrote it', () => {
        const opened = open('P = (1, 2) @ dragMode: XY, pointSize: 20, color: #2d70b3');
        item(opened.after, 'expr_1').latex = 'P=\\left(3,4\\right)';

        assert.equal(
            write(opened).source,
            'P = (3, 4) @ dragMode: XY, pointSize: 20, color: #2d70b3',
        );
    });

    test('takes a property off when the graph takes it off', () => {
        const opened = open('y = x @ lineStyle: DASHED, lineWidth: 3');
        delete item(opened.after, 'expr_1').lineStyle;

        const { source } = write(opened);
        assert.equal(source, 'y = x @ lineWidth: 3');
        reproduces(opened, source);
    });

    test('writes a note, a string and a flag', () => {
        const opened = open('"hello" @ secret\ny = x @ label: "a"');
        item(opened.after, 'note_1').text = 'goodbye';
        item(opened.after, 'expr_2').label = 'b';
        item(opened.after, 'expr_2').showLabel = true;
        item(opened.after, 'expr_2').hidden = false;

        const { source } = write(opened);
        assert.equal(source, '"goodbye" @ secret\ny = x @ label: "b", hidden: false, showLabel');
        reproduces(opened, source);
    });

    test('writes a clickable action and switches it off', () => {
        const opened = open('a = 0\nP = (1, 1) @ onClick: a -> a + 1');
        item(opened.after, 'expr_2').clickableInfo = { latex: 'a\\to a+2' };

        const { source } = write(opened);
        assert.equal(source, 'a = 0\nP = (1, 1) @ onClick: a -> a + 2, clickable: false');
        reproduces(opened, source);
    });

    test('writes a parametric domain once, not once per key Desmos keeps it under', () => {
        const opened = open('(cos(t), sin(t)) @ domain: 0..pi');
        const live = item(opened.after, 'expr_1');
        live.domain = { min: '0', max: '2\\pi' };
        live.parametricDomain = { min: '0', max: '2\\pi' };

        const { source } = write(opened);
        assert.equal(source, '(cos(t), sin(t)) @ domain: 0..2pi');
        reproduces(opened, source);
    });

    test("writes a movable point's size only where it parts from `pointSize`", () => {
        const opened = open('P = (1, 2) @ dragMode: XY, pointSize: 12');
        item(opened.after, 'expr_1').movablePointSize = '20';

        const { source } = write(opened);
        assert.equal(source, 'P = (1, 2) @ dragMode: XY, pointSize: 12, movablePointSize: 20');
        reproduces(opened, source);
    });

    test("rewrites a folder's own line and leaves its body alone", () => {
        const opened = open('folder "A" {\n    y=x^2 // as typed\n}');
        item(opened.after, 'folder_1').title = 'B';
        item(opened.after, 'folder_1').collapsed = true;

        const { source } = write(opened);
        assert.equal(source, 'folder "B" { @ collapsed\n    y=x^2 // as typed\n}');
        reproduces(opened, source);
    });

    test('gives a folder on one line its metadata without running it into the body', () => {
        const opened = open('folder "A" { y = x }');
        item(opened.after, 'folder_1').hidden = true;

        const { source } = write(opened);
        assert.equal(source, 'folder "A" { @ hidden; y = x }');
        reproduces(opened, source);
    });

    test("writes an edited table cell and a column's colour into that column", () => {
        const opened = open(
            'table { @ color: BLUE\n    x = [1, 2]\n    y = [3, 4] @ pointStyle: CROSS\n}',
        );
        const table = item(opened.after, 'table_3') as { columns: Item[] };
        table.columns[1].values = ['3', '9'];
        table.columns[0].color = '#c74440';

        const { source } = write(opened);
        assert.equal(
            source,
            'table { @ color: BLUE\n    x = [1, 2] @ color: RED\n    y = [3, 9] @ pointStyle: CROSS\n}',
        );
        reproduces(opened, source);
    });

    test('says which changed keys no property can write, and writes the rest', () => {
        const opened = open('y = x');
        const live = item(opened.after, 'expr_1');
        live.latex = 'y=2x';
        live.residualVariable = 'e_1';

        const { source, skipped } = write(opened);
        assert.equal(source, 'y = 2x');
        assert.equal(skipped.length, 1);
        assert.match(skipped[0].reason, /`residualVariable`/);
    });
});

describe('statements sharing a line', () => {
    test('are each rewritten on their own', () => {
        const opened = open('a = 1; b = 2; c = 3 // three');
        item(opened.after, 'expr_2').latex = 'b=7';

        const { source, skipped } = write(opened);
        assert.deepEqual(skipped, []);
        assert.equal(source, 'a = 1; b = 7; c = 3 // three');
        reproduces(opened, source);
    });

    test('inside a folder written on one line', () => {
        const opened = open('folder "A" { P = (1, 2); Q = (3, 4) }');
        item(opened.after, 'expr_2').latex = 'P=\\left(8,9\\right)';
        item(opened.after, 'expr_3').latex = 'Q=\\left(0,0\\right)';

        const { source } = write(opened);
        assert.equal(source, 'folder "A" { P = (8, 9); Q = (0, 0) }');
        reproduces(opened, source);
    });

    test('are deleted one at a time, separator and all', () => {
        const first = open('a = 1; b = 2');
        remove(first.after, 'expr_1');
        assert.equal(write(first).source, 'b = 2');

        const last = open('folder "A" { a = 1; b = 2 }');
        remove(last.after, 'expr_3');
        assert.equal(write(last).source, 'folder "A" { a = 1 }');
    });
});

describe('a metadata block', () => {
    test('stays a block, comments and all', () => {
        const opened = open(
            [
                'P = (1, 2) @{',
                '    // how it moves',
                '    dragMode: XY',
                '    pointSize: 12 // big',
                '}',
            ].join('\n'),
        );
        const live = item(opened.after, 'expr_1');
        live.pointSize = '20';
        live.movablePointSize = '20';

        const { source } = write(opened);
        assert.equal(
            source,
            [
                'P = (1, 2) @{',
                '    // how it moves',
                '    dragMode: XY',
                '    pointSize: 20 // big',
                '}',
            ].join('\n'),
        );
        reproduces(opened, source);
    });

    test('takes new properties one to a line, at the end', () => {
        const opened = open(['y = x @{', '    lineWidth: 3', '}'].join('\n'));
        const live = item(opened.after, 'expr_1');
        live.color = '#123456';
        live.lineStyle = 'DASHED';

        const { source } = write(opened);
        assert.equal(
            source,
            [
                'y = x @{',
                '    lineWidth: 3',
                '    color: #123456',
                '    lineStyle: DASHED',
                '}',
            ].join('\n'),
        );
        reproduces(opened, source);
    });
});

describe('a style', () => {
    const style = 'style swatch { color: RED; pointSize: 12 }\n';

    test('is overridden on the statement, never expanded into it', () => {
        const opened = open(`${style}P = (1, 2) @ use: swatch`);
        item(opened.after, 'expr_1').color = '#2d70b3';

        const { source } = write(opened);
        assert.equal(source, `${style}P = (1, 2) @ use: swatch, color: BLUE`);
        reproduces(opened, source);
    });

    test('is left alone when the property the statement set itself changed', () => {
        const opened = open(`${style}P = (1, 2) @ use: swatch, color: GREEN`);
        item(opened.after, 'expr_1').color = '#6042a6';

        assert.equal(write(opened).source, `${style}P = (1, 2) @ use: swatch, color: PURPLE`);
    });

    test('is not written back into when nothing but a moved point changed', () => {
        const opened = open(`${style}P = (1, 2) @ use: swatch`);
        item(opened.after, 'expr_1').latex = 'P=\\left(0,0\\right)';

        assert.equal(write(opened).source, `${style}P = (0, 0) @ use: swatch`);
    });
});

describe('a slider', () => {
    test('keeps the bound Desmos did not hand back', () => {
        // Exactly what a calculator reads back: the max is Desmos' own
        // default, so it is left off the state - and dragging the slider must
        // not take it out of the script.
        const opened = open('a = 1 @ slider: 0..10');
        const read = item(opened.before, 'expr_1').slider as Item;
        delete read.max;
        opened.after = structuredClone(opened.before);
        item(opened.after, 'expr_1').latex = 'a=6.25';

        const { source } = write(opened);
        assert.equal(source, 'a = 6.25 @ slider: 0..10');
    });

    test('rewrites the end that moved and keeps the others', () => {
        const opened = open('a = 1 @ slider: 0..10 step 0.5');
        (item(opened.after, 'expr_1').slider as Item).min = '-5';

        const { source } = write(opened);
        assert.equal(source, 'a = 1 @ slider: -5..10 step 0.5');
        reproduces(opened, source);
    });

    test('writes a bound let go of as a soft end', () => {
        const opened = open('a = 1 @ slider: 0..10');
        delete (item(opened.after, 'expr_1').slider as Item).hardMax;

        const { source } = write(opened);
        assert.equal(source, 'a = 1 @ slider: 0..10 soft max');
        reproduces(opened, source);
    });

    test('grows a slider where there was none', () => {
        const opened = open('a = 1');
        item(opened.after, 'expr_1').slider = {
            min: '0',
            max: '5',
            hardMin: true,
            hardMax: true,
            step: '1',
        };

        const { source } = write(opened);
        assert.equal(source, 'a = 1 @ slider: 0..5 step 1');
        reproduces(opened, source);
    });
});

describe('what it refuses to write', () => {
    test('a statement a macro expanded into', () => {
        const opened = open('macro PT(a, b) = (a, b)\nP = PT(1, 2)');
        item(opened.after, 'expr_1').latex = 'P=\\left(8,9\\right)';

        const { edits, skipped, source } = write(opened);

        assert.deepEqual(edits, []);
        assert.equal(skipped.length, 1);
        assert.match(skipped[0].reason, /macro/);
        assert.equal(source, opened.source);
    });

    test('but deletes one, which needs nothing the graph holds', () => {
        const opened = open('macro PT(a, b) = (a, b)\nP = PT(1, 2)\ny = x');
        remove(opened.after, 'expr_1');

        assert.equal(write(opened).source, 'macro PT(a, b) = (a, b)\ny = x');
    });

    test('a statement in a file this script imports, by name', () => {
        const opened = open('import "./lib.axis"\ny = x', {
            resolveImport: () => ({ path: 'lib.axis', source: 'L = (1, 2)' }),
        });
        item(opened.after, 'expr_2').latex = 'L=\\left(5,5\\right)';

        const { edits, skipped } = write(opened);
        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /lib\.axis/);
    });

    test('an expression moved into another folder', () => {
        const opened = open('folder "A" { y = x }\nz = 1');
        item(opened.after, 'expr_3').folderId = 'folder_1';

        const { edits, skipped } = write(opened);
        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /between folders/);
    });

    test('a script that changed since the graph was compiled', () => {
        const opened = open('y = x\nP = (1, 2)');
        item(opened.after, 'expr_2').latex = 'P=\\left(3,3\\right)';

        const result = writeBackGraph('// typed since\ny = x\nP = (1, 2)', opened, opened.compiled);
        assert.deepEqual(result.edits, []);
        assert.match(result.skipped[0].reason, /changed since/);
    });

    test('a statement whose comment has nowhere to go once it is rewritten', () => {
        // A comment inside a bracket spread over lines is kept by the printer
        // only by keeping the whole statement as written - which would be the
        // change silently not made.
        const opened = open('L = [\n    1, // the first\n    2\n]');
        item(opened.after, 'expr_1').latex = 'L=\\left[1,5\\right]';

        const { edits, skipped } = write(opened);
        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /comment/);
    });

    test('an expression that was never in this script', () => {
        const opened = open('y = x');
        opened.after.state.expressions!.list!.push({
            type: 'expression',
            id: 'nope',
            latex: 'z=1',
            folderId: 'folder_404',
        });

        const { skipped } = write(opened);
        assert.equal(skipped.length, 1);
        assert.match(skipped[0].reason, /folder that is not in this script/);
    });
});

describe('a picture', () => {
    // `image "./beach.png"` is read off a disk and inlined as a `data:` URI
    // before the graph exists, so the graph carries the bytes and has no memory
    // of the path. Writing one back naively puts the whole picture, in base64,
    // where the filename was.
    const resolveImage = () => ({
        path: './beach.png',
        dataUri: 'data:image/png;base64,AAAABBBBCCCCDDDD',
    });

    /** Compile a script that draws a picture, and drag the picture. */
    function dragged(source: string) {
        const opened = open(source, { resolveImage });
        const image = list(opened.after).find(candidate => candidate.type === 'image');
        assert.ok(image, 'no image in the graph');
        image.center = '\\left(3,2\\right)';
        return { opened, ...write(opened) };
    }

    test('keeps the path it was written with', () => {
        const { opened, source, skipped } = dragged(
            '// keep me\nimage "./beach.png" @ center: (0, 0), width: 5',
        );

        assert.deepEqual(skipped, []);
        assert.equal(source, '// keep me\nimage "./beach.png" @ center: (3, 2), width: 5');
        reproduces(opened, source, { resolveImage });
    });

    test('keeps it through a metadata block', () => {
        const { source } = dragged('image "./beach.png" @{\n    center: (0, 0)\n    width: 5\n}');
        assert.equal(source, 'image "./beach.png" @{\n    center: (3, 2)\n    width: 5\n}');
    });

    test('leaves a picture named by URL exactly as it was', () => {
        const { source } = dragged('image "https://example.com/a.png" @ center: (0, 0)');
        assert.equal(source, 'image "https://example.com/a.png" @ center: (3, 2)');
    });

    test('added in Desmos, with its bytes, is refused rather than inlined', () => {
        const opened = open('y = x');
        opened.after.state.expressions!.list!.push({
            type: 'image',
            id: '9',
            image_url: 'data:image/png;base64,AAAABBBBCCCCDDDD',
            center: '\\left(0,0\\right)',
        });

        const { edits, skipped, source } = write(opened);
        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /give it a name/);
        assert.equal(source, opened.source);
    });

    test('added in Desmos by URL is written, since that is a name', () => {
        const opened = open('y = x');
        opened.after.state.expressions!.list!.push({
            type: 'image',
            id: '9',
            image_url: 'https://example.com/a.png',
            center: '\\left(0,0\\right)',
        });

        assert.equal(
            write(opened).source,
            'y = x\nimage "https://example.com/a.png" @ center: (0, 0)',
        );
    });
});

describe('a graph that is moving by itself', () => {
    test('does not write an animating slider back', () => {
        const opened = open('s = 0.35 @ slider: 0..1, playing');
        item(opened.after, 'expr_1').latex = 's=0.68';

        const { edits, skipped } = write(opened);
        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /slider is animating/);
    });

    test('writes it back once it is paused', () => {
        const opened = open('s = 0.35 @ slider: 0..1, playing');
        const live = item(opened.after, 'expr_1');
        live.latex = 's=0.68';
        (live.slider as Item).isPlaying = false;

        const { source } = write(opened);
        assert.equal(source, 's = 0.68 @ slider: 0..1, playing: false');
        reproduces(opened, source);
    });

    test('writes nothing at all while the ticker is running', () => {
        const opened = open('ticker a -> a + 1 @ playing\na = 0\nP = (1, 2)');
        item(opened.after, 'expr_1').latex = 'a=57';
        item(opened.after, 'expr_2').latex = 'P=\\left(9,9\\right)';

        const { edits, skipped } = write(opened);
        assert.deepEqual(edits, []);
        assert.equal(skipped.length, 2);
        assert.match(skipped[0].reason, /ticker is running/);
    });

    test('nor once a ticker that ran since the graph loaded is paused', () => {
        // Pausing it is the user's doing; the 57 it left behind is not, and
        // there is no telling that apart from a drag.
        const opened = open('ticker a -> a + 1 @ playing\na = 0');
        item(opened.after, 'expr_1').latex = 'a=57';
        delete opened.after.state.expressions!.ticker!.playing;

        const { source, skipped } = write(opened);
        assert.equal(source, 'ticker a -> a + 1\na = 0');
        assert.match(skipped[0].reason, /ticker has been running/);
    });

    test("writes a paused ticker's own properties into its statement", () => {
        const opened = open('ticker a -> a + 1 @ minStep: 50\na = 0');
        opened.after.state.expressions!.ticker!.minStepLatex = '100';
        opened.after.state.expressions!.ticker!.handlerLatex = 'a\\to a+2';

        const { source } = write(opened);
        assert.equal(source, 'ticker a -> a + 2 @ minStep: 100\na = 0');
        reproduces(opened, source);
    });
});

describe('settings', () => {
    test('are written into the config block, around its comments', () => {
        const opened = open(
            [
                'config {',
                '    // the grid',
                '    showGrid: true',
                '}',
                '',
                '// still here',
                'y = x',
            ].join('\n'),
        );
        opened.after.options = { ...opened.after.options, showGrid: false, degreeMode: true };

        const { source } = write(opened);
        assert.equal(
            source,
            [
                'config {',
                '    // the grid',
                '    showGrid: false',
                '    degreeMode',
                '}',
                '',
                '// still here',
                'y = x',
            ].join('\n'),
        );
    });

    test('keep a config block on one line on one line', () => {
        const opened = open('config { showGrid: true }\ny = x');
        opened.after.options = { ...opened.after.options, showGrid: false };

        assert.equal(write(opened).source, 'config { showGrid: false }\ny = x');
    });

    test('open a config block at the top of a script that has none', () => {
        const opened = open('// a script with no settings\ny = x');
        opened.after.options = { ...opened.after.options, showGrid: false };

        const { source } = write(opened);
        assert.equal(
            source,
            'config {\n    showGrid: false\n}\n\n// a script with no settings\ny = x',
        );
    });

    test('are left alone when the change is not asked for', () => {
        const opened = open('config {\n    xmin: -10\n}\ny = x');
        opened.after.state.graph = { viewport: { xmin: -20, xmax: 20, ymin: -5, ymax: 5 } };

        assert.deepEqual(write(opened, { include: { settings: false } }).edits, []);
    });
});

describe('the viewport', () => {
    test('is written back for a script that framed itself', () => {
        const opened = open('config {\n    xmin: -5\n    xmax: 5\n}\ny = x');
        opened.after.state.graph = { viewport: { xmin: -20, xmax: 20, ymin: -8, ymax: 8 } };

        const { source } = write(opened);
        assert.equal(
            source,
            'config {\n    xmin: -20\n    xmax: 20\n    ymin: -8\n    ymax: 8\n}\ny = x',
        );
        reproduces(opened, source);
    });

    test('is left out of a script that never named one', () => {
        const opened = open('config {\n    showGrid: false\n}\ny = x');
        opened.after.state.graph = { viewport: { xmin: -20, xmax: 20, ymin: -8, ymax: 8 } };

        const { source, skipped } = write(opened);
        assert.equal(source, opened.source);
        assert.match(skipped[0].reason, /viewport/);
    });

    test('does not open a config block on a pan alone', () => {
        const opened = open('// no settings at all\ny = x');
        opened.after.state.graph = { viewport: { xmin: -20, xmax: 20, ymin: -8, ymax: 8 } };

        assert.deepEqual(write(opened).edits, []);
    });
});

describe('an expression made in the calculator', () => {
    test('lands at the end of the script', () => {
        const opened = open('// a comment\ny = x');
        opened.after.state.expressions!.list!.push({
            type: 'expression',
            id: '9',
            latex: 'z=3',
            color: '#c74440',
        });

        assert.equal(write(opened).source, '// a comment\ny = x\nz = 3 @ color: RED');
    });

    test('lands inside the folder it was made in', () => {
        const opened = open('folder "Shapes" {\n    y = x\n}\n\nq = 1');
        opened.after.state.expressions!.list!.push({
            type: 'expression',
            id: '9',
            latex: 'z=3',
            folderId: 'folder_1',
        });

        assert.equal(write(opened).source, 'folder "Shapes" {\n    y = x\n    z = 3\n}\n\nq = 1');
    });

    test('lands on the line of a folder written on one', () => {
        const opened = open('folder "Shapes" { y = x }');
        opened.after.state.expressions!.list!.push({
            type: 'expression',
            id: '9',
            latex: 'z=3',
            folderId: 'folder_1',
        });

        assert.equal(write(opened).source, 'folder "Shapes" { y = x; z = 3 }');
    });

    test('is written with the folder it was made in, when that is new too', () => {
        const opened = open('y = x');
        opened.after.state.expressions!.list!.push(
            { type: 'folder', id: 'f', title: 'New' },
            { type: 'expression', id: 'e1', latex: 'a=1', folderId: 'f' },
            { type: 'text', id: 'e2', text: 'hi', folderId: 'f' },
        );

        const { source } = write(opened);
        assert.equal(source, 'y = x\nfolder "New" {\n    a = 1\n    "hi"\n}');
    });

    test('is not written into the folder an import stands for', () => {
        const opened = open('import "./lib.axis"', {
            resolveImport: () => ({ path: 'lib.axis', source: 'L = 1' }),
        });
        opened.after.state.expressions!.list!.push({
            type: 'expression',
            id: '9',
            latex: 'z=3',
            folderId: 'folder_1',
        });

        const { edits, skipped } = write(opened);
        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /import/);
    });
});

describe('an expression deleted in the calculator', () => {
    test('is deleted from the script, lines and trailing comment with it', () => {
        const opened = open('// a comment\ny = x // gone\nz = 3');
        remove(opened.after, 'expr_1');

        assert.equal(write(opened).source, '// a comment\nz = 3');
    });

    test('takes the last line of a script without leaving it dangling', () => {
        const opened = open('y = x\nz = 3');
        remove(opened.after, 'expr_2');

        assert.equal(write(opened).source, 'y = x');
    });

    test('with its folder is one edit for the folder', () => {
        const opened = open('folder "A" {\n    y = x\n    z = 3\n}\nq = 1');
        remove(opened.after, 'folder_1');
        remove(opened.after, 'expr_2');
        remove(opened.after, 'expr_3');

        const { edits, source } = write(opened);
        assert.equal(edits.length, 1);
        assert.equal(source, 'q = 1');
    });
});

describe('several changes at once', () => {
    test('are applied without one moving the characters of another', () => {
        const opened = open(
            ['P = (1, 2)', '', '// keep me', 'Q = (3, 4)', '', 'R = (5, 6)'].join('\n'),
        );
        item(opened.after, 'expr_1').latex = 'P=\\left(19,19\\right)';
        item(opened.after, 'expr_2').latex = 'Q=\\left(8,8\\right)';
        item(opened.after, 'expr_3').latex = 'R=\\left(7,7\\right)';

        const { source } = write(opened);
        assert.equal(
            source,
            ['P = (19, 19)', '', '// keep me', 'Q = (8, 8)', '', 'R = (7, 7)'].join('\n'),
        );
        reproduces(opened, source);
    });

    test('come back ordered latest-first, so a host can apply them in turn', () => {
        const opened = open('P = (1, 2)\nQ = (3, 4)\nR = (5, 6)');
        item(opened.after, 'expr_1').latex = 'P=\\left(9,9\\right)';
        item(opened.after, 'expr_3').latex = 'R=\\left(7,7\\right)';

        const { edits } = write(opened);
        assert.deepEqual(
            edits.map(edit => edit.span.start),
            [22, 0],
        );
        assert.ok(edits.every(edit => edit.path === PATH));
    });
});

describe('a graph nobody touched', () => {
    test('writes nothing, over every kind of statement', () => {
        const opened = open(
            [
                'config {',
                '    xmin: -5',
                '}',
                'style s { color: RED }',
                'a = 1 @ slider: 0..10, playing',
                'y = x^2 @ use: s, lineStyle: DASHED',
                'folder "F" { @ collapsed',
                '    P = (1, 2) @ dragMode: XY',
                '}',
                'table { x = [1, 2]; y_1 = [3, 4] }',
                '"a note"',
                'ticker a -> a + 1',
            ].join('\n'),
        );

        const result = writeBackGraph(opened.source, opened, opened.compiled);
        assert.deepEqual(result, { edits: [], skipped: [] });
    });

    test('including a script it has just written itself', () => {
        const opened = open('P = (1, 2) @ dragMode: XY\ny = x @ color: RED');
        item(opened.after, 'expr_1').latex = 'P=\\left(4,4\\right)';
        item(opened.after, 'expr_2').color = '#123456';
        const { source } = write(opened);

        // The next round: the graph the new script builds, read against itself.
        const next = open(source);
        assert.deepEqual(diffGraphs(next.before, opened.after), []);
        assert.deepEqual(writeBackGraph(source, next, next.compiled).edits, []);
    });
});
