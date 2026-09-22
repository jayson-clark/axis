// ═════════════════════════════════════════════════════════════════════════════
// A changed graph, back into the script that built it
// ═════════════════════════════════════════════════════════════════════════════
//
// What the cases below are really about is what survives. Any of them could be
// made to pass by decompiling the whole graph and writing the file out again -
// and every one of them would then be testing nothing, because the comments,
// the blank lines, the macros and the layout the author chose would be gone.
//
// So each test drags something and then asserts on the rest of the file: that
// it is byte-for-byte what it was. `unchanged` is the helper that says it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applySourceEdits, diffGraphs, writeBackGraph } from '../dist/index.js';
import type { GraphSnapshot, SourceEdit } from '../dist/index.js';
// The v1 compiler, which the v1 write-back reads a compilation of until #24
// replaces both. Reached into directly because it is no longer exported.
import { compileAxis } from '../dist/legacy/compile.js';
import type { CompilationResult } from '../dist/legacy/compile.js';

const PATH = 'main.axis';

/** The graph a script compiles to, as a snapshot of a calculator holding it. */
function snapshot(compiled: CompilationResult): GraphSnapshot {
    return {
        // Deep-copied, so a test that edits the snapshot is not also editing
        // the compilation it is about to be compared against.
        expressions: structuredClone(compiled.expressions),
        settings: structuredClone(compiled.settings),
        graph: structuredClone(compiled.graph),
        state: structuredClone(compiled.state),
        ticker: structuredClone(compiled.ticker),
    };
}

/** Compile a script and take the graph it built, ready to be changed. */
function open(source: string) {
    const compiled = compileAxis(source, { path: PATH });
    return { compiled, before: snapshot(compiled), after: snapshot(compiled) };
}

/** Run the write-back and apply it, returning the new source and the report. */
function write(
    compiled: CompilationResult,
    before: GraphSnapshot,
    after: GraphSnapshot,
    source: string,
    options = {},
) {
    const result = writeBackGraph(compiled, before, after, new Map([[PATH, source]]), options);
    return { ...result, source: applySourceEdits(source, result.edits) };
}

/** The expression with this id, in a snapshot. */
function find(snapshot: GraphSnapshot, id: string) {
    const expression = snapshot.expressions.find(candidate => candidate.id === id);
    assert.ok(expression, `no expression ${id}`);
    return expression as Record<string, unknown>;
}

/**
 * Every line of `before` that is not in the span `edited`, still exactly itself
 * in `after`.
 *
 * The whole point of writing a statement back rather than a file: what was not
 * changed is not touched, down to the trailing whitespace.
 */
function unchanged(before: string, after: string, edited: readonly number[]) {
    const was = before.split('\n');
    const now = after.split('\n');
    const skip = new Set(edited);

    // Lines are matched by counting past the edited ones on each side, so a
    // replacement that grows or shrinks does not read as a mismatch.
    let a = 0;
    let b = 0;
    while (a < was.length && b < now.length) {
        if (skip.has(a)) {
            a++;
            b++;
            continue;
        }
        assert.equal(now[b], was[a], `line ${a} was rewritten`);
        a++;
        b++;
    }
}

describe('what changed', () => {
    test('sees a point that moved, and nothing else', () => {
        const { before, after } = open('y = x^2\nP = (1, 2)\nQ = (3, 4)');
        find(after, 'expr_2').latex = 'P=\\left(1.5,2.5\\right)';

        assert.deepEqual(
            diffGraphs(before, after).map(change => [change.kind, change.id]),
            [['changed', 'expr_2']],
        );
    });

    test('is not fooled by a state whose keys came back in another order', () => {
        const { before, after } = open('y = x # color: red, lineWidth: 3');
        const expression = find(after, 'expr_1');
        const { latex, id, type, ...rest } = expression;
        after.expressions[0] = { id, ...rest, type, latex } as never;

        assert.deepEqual(diffGraphs(before, after), []);
    });

    test('sees an expression added and one removed', () => {
        const { before, after } = open('y = x');
        after.expressions.push({ type: 'expression', id: '7', latex: 'z=3' });
        after.expressions = after.expressions.filter(e => e.id !== 'expr_1');

        assert.deepEqual(
            diffGraphs(before, after)
                .map(change => change.kind)
                .sort(),
            ['added', 'removed'],
        );
    });

    test('sees the viewport move', () => {
        const { before, after } = open('y = x');
        after.graph = { viewport: { xmin: -20, xmax: 20, ymin: -20, ymax: 20 } };

        assert.deepEqual(
            diffGraphs(before, after).map(change => change.kind),
            ['settings'],
        );
    });
});

describe('writing one statement back', () => {
    test('rewrites the statement a dragged point came from', () => {
        const source = [
            '// The parabola, which nobody dragged',
            'y = x^2',
            '',
            '// The point, which somebody did',
            'P = (1, 2)',
        ].join('\n');
        const { compiled, before, after } = open(source);
        find(after, 'expr_2').latex = 'P=\\left(1.5,2.5\\right)';

        const { source: written, skipped } = write(compiled, before, after, source);

        assert.deepEqual(skipped, []);
        assert.equal(written.split('\n')[4], 'P = (1.5, 2.5)');
        unchanged(source, written, [4]);
    });

    test('keeps the comment on the line it rewrites', () => {
        const source = 'P = (1, 2) // the anchor';
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').latex = 'P=\\left(9,9\\right)';

        assert.equal(write(compiled, before, after, source).source, 'P = (9, 9) // the anchor');
    });

    test('keeps the indentation of a statement inside a folder', () => {
        const source = 'folder "Points" {\n    P = (1, 2)\n}';
        const { compiled, before, after } = open(source);
        find(after, 'expr_2').latex = 'P=\\left(5,6\\right)';

        const { source: written } = write(compiled, before, after, source);
        assert.equal(written, 'folder "Points" {\n    P = (5, 6)\n}');
    });

    test('writes a recolour into the metadata', () => {
        const source = 'y = x^2 # color: #c74440';
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').color = '#2d70b3';

        // Spaced as the formatter spaces it, which is how the decompiler
        // writes every statement - so a rewritten one reads like the rest.
        assert.equal(write(compiled, before, after, source).source, 'y = x ^ 2 # color: #2d70b3');
    });

    test('writes a metadata block back as a block', () => {
        const source = ['P = (1, 2) #{', '    dragMode: XY', '    pointSize: 12', '}'].join('\n');
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').pointSize = 20;

        const { source: written } = write(compiled, before, after, source);

        assert.match(written, /^P = \(1, 2\) #\{$/m);
        assert.match(written, /^ {4}pointSize: 20$/m);
        assert.match(written, /^\}$/m);
    });

    test('keeps the metadata in the order the author wrote it', () => {
        // The decompiler's own order is color, lineStyle, …, dragMode. This
        // statement is not in it, and rewriting it must not put it in it.
        const source = 'P = (1, 2) # dragMode: XY, pointSize: 20, color: #2d70b3';
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').latex = 'P=\\left(3,4\\right)';

        const { source: written } = write(compiled, before, after, source);
        assert.equal(written, 'P = (3, 4) # dragMode: XY, pointSize: 20, color: #2d70b3');
    });

    test('puts a property the graph grew where the decompiler puts it', () => {
        const source = 'P = (1, 2) # dragMode: XY';
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').color = '#2d70b3';

        const { source: written } = write(compiled, before, after, source);
        assert.equal(written, 'P = (1, 2) # dragMode: XY, color: #2d70b3');
    });

    test('is its own inverse: the graph written back is the graph on screen', () => {
        const source = 'a = 1 # sliderBounds: [0, 10]\nP = (a, 2)';
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').latex = 'a=4.5';

        const { source: written } = write(compiled, before, after, source);

        assert.deepEqual(compileAxis(written, { path: PATH }).expressions, after.expressions);
    });
});

describe('what it refuses to write', () => {
    test('a statement a macro expanded into', () => {
        // A `macro` line emits nothing and takes no id, so the statement
        // below it is the first expression.
        const source = 'macro PT(a, b) (a, b)\nP = PT(1, 2)';
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').latex = 'P=\\left(8,9\\right)';

        const { edits, skipped, source: written } = write(compiled, before, after, source);

        assert.deepEqual(edits, []);
        assert.equal(skipped.length, 1);
        assert.match(skipped[0].reason, /macro/);
        assert.equal(written, source);
    });

    test('a statement sharing its line with another', () => {
        const source = 'folder "A" { P = (1, 2), Q = (3, 4) }';
        const { compiled, before, after } = open(source);
        find(after, 'expr_2').latex = 'P=\\left(8,9\\right)';

        const { edits, skipped, source: written } = write(compiled, before, after, source);

        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /share this line/);
        assert.equal(written, source);
    });

    test('an expression that was never in this script', () => {
        const source = 'y = x';
        const { compiled, before, after } = open(source);
        after.expressions.push({
            type: 'expression',
            id: 'nope',
            latex: 'z=1',
            folderId: 'folder_404',
        });

        const { skipped } = write(compiled, before, after, source, {
            include: { added: true },
        });

        assert.equal(skipped.length, 1);
        assert.match(skipped[0].reason, /folder that is not in this script/);
    });
});

describe('settings', () => {
    test('rewrites the config block a pan changed', () => {
        const source = [
            'config {',
            '    xmin: -10',
            '    xmax: 10',
            '    ymin: -10',
            '    ymax: 10',
            '}',
            '',
            '// still here',
            'y = x',
        ].join('\n');
        const { compiled, before, after } = open(source);
        after.graph = { viewport: { xmin: -20, xmax: 20, ymin: -5, ymax: 5 } };

        const { source: written } = write(compiled, before, after, source);

        assert.match(written, /xmin: -20/);
        assert.match(written, /ymax: 5/);
        assert.match(written, /\/\/ still here\ny = x$/);
    });

    test('opens a config block for a script that has none', () => {
        // A setting rather than a framing: the viewport is deliberately not
        // enough to open a block - see "the viewport" below.
        const source = '// a script with no settings\ny = x';
        const { compiled, before, after } = open(source);
        after.settings = { ...after.settings, showGrid: false };

        const { source: written } = write(compiled, before, after, source);

        assert.match(written, /^config \{/);
        assert.match(written, /showGrid: false/);
        assert.match(written, /\/\/ a script with no settings\ny = x$/);
    });

    test('is left alone when the change is not asked for', () => {
        const source = 'config {\n    xmin: -10\n}\ny = x';
        const { compiled, before, after } = open(source);
        after.graph = { viewport: { xmin: -20, xmax: 20, ymin: -5, ymax: 5 } };

        const { edits } = write(compiled, before, after, source, {
            include: { settings: false },
        });

        assert.deepEqual(edits, []);
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
        const compiled = compileAxis(source, { path: PATH, resolveImage });
        const before = snapshot(compiled);
        const after = snapshot(compiled);

        const image = after.expressions.find(expression => expression.type === 'image');
        assert.ok(image, 'no image in the graph');
        (image as { center?: string }).center = '\\left(3,2\\right)';

        return write(compiled, before, after, source);
    }

    test('keeps the path it was written with', () => {
        const source = '// keep me\nimage "./beach.png" # center: (0, 0), width: 5';
        const { source: written, skipped } = dragged(source);

        assert.deepEqual(skipped, []);
        assert.equal(written, '// keep me\nimage "./beach.png" # center: (3, 2), width: 5');
        assert.doesNotMatch(written, /data:image/);
    });

    test('keeps it through a metadata block', () => {
        const source = 'image "./beach.png" #{\n    center: (0, 0)\n    width: 5\n}';
        const { source: written } = dragged(source);

        assert.match(written, /^image "\.\/beach\.png" #\{$/m);
        assert.match(written, /^ {4}center: \(3, 2\)$/m);
        assert.doesNotMatch(written, /data:image/);
    });

    test('leaves a picture named by URL exactly as it was', () => {
        // The one case where the graph's URL and the script's agree — it still
        // has to come from the script, since only the script has the quoting.
        const source = 'image "https://example.com/a.png" # center: (0, 0)';
        const { source: written } = dragged(source);

        assert.equal(written, 'image "https://example.com/a.png" # center: (3, 2)');
    });

    test('added in Desmos, with its bytes, is refused rather than inlined', () => {
        // Desmos hands a picture over as a `data:` URI. A script has no
        // statement that means "these bytes" - only ones that name a file or a
        // URL - so writing it out would put the whole picture into the source.
        const source = 'y = x';
        const compiled = compileAxis(source, { path: PATH });
        const before = snapshot(compiled);
        const after = snapshot(compiled);
        after.expressions.push({
            type: 'image',
            id: '9',
            image_url: 'data:image/png;base64,AAAABBBBCCCCDDDD',
            center: '\\left(0,0\\right)',
        });

        const { edits, skipped, source: written } = write(compiled, before, after, source);

        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /give it a name/);
        assert.equal(written, source);
    });

    test('added in Desmos by URL is written, since that is a name', () => {
        const source = 'y = x';
        const compiled = compileAxis(source, { path: PATH });
        const before = snapshot(compiled);
        const after = snapshot(compiled);
        after.expressions.push({
            type: 'image',
            id: '9',
            image_url: 'https://example.com/a.png',
            center: '\\left(0,0\\right)',
        });

        const { source: written } = write(compiled, before, after, source);
        assert.equal(written, 'y = x\nimage "https://example.com/a.png" # center: (0, 0)');
    });

    test('is written rather than refused, so dragging one still works', () => {
        const source = 'image "./beach.png" # center: (0, 0)';
        const { edits, source: written } = dragged(source);

        assert.equal(edits.length, 1);
        assert.match(written, /center: \(3, 2\)/);
    });
});

describe('a graph that is moving by itself', () => {
    test('does not write an animating slider back', () => {
        const source = 's = 0.35 # sliderBounds: {min: 0, max: 1}, playing: true';
        const { compiled, before, after } = open(source);
        // What a playing slider does several times a second.
        find(after, 'expr_1').latex = 's=0.68';

        const { edits, skipped, source: written } = write(compiled, before, after, source);

        assert.deepEqual(edits, []);
        assert.match(skipped[0].reason, /animating/);
        assert.equal(written, source);
    });

    test('writes it back once it is paused', () => {
        const source = 's = 0.35 # sliderBounds: {min: 0, max: 1}, playing: true';
        const { compiled, before, after } = open(source);
        const live = find(after, 'expr_1');
        live.latex = 's=0.68';
        (live.slider as Record<string, unknown>).isPlaying = false;

        const { source: written } = write(compiled, before, after, source);
        assert.match(written, /s = 0\.68/);
    });

    test('writes nothing at all while the ticker is running', () => {
        const source = 'ticker a -> a + 1 # playing: true\na = 0\nP = (1, 2)';
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').latex = 'a=57';
        find(after, 'expr_2').latex = 'P=\\left(9,9\\right)';

        const { edits, skipped } = write(compiled, before, after, source);

        assert.deepEqual(edits, []);
        assert.equal(skipped.length, 2);
        assert.match(skipped[0].reason, /ticker is running/);
    });
});

describe('the viewport', () => {
    test('is written back for a script that framed itself', () => {
        const source = 'config {\n    xmin: -5\n    xmax: 5\n    ymin: -5\n    ymax: 5\n}\ny = x';
        const { compiled, before, after } = open(source);
        after.graph = { viewport: { xmin: -20, xmax: 20, ymin: -8, ymax: 8 } };

        const { source: written } = write(compiled, before, after, source);
        assert.match(written, /xmin: -20/);
    });

    test('is left out of a script that never named one', () => {
        // Panning is how anybody reads a graph. A script that said nothing
        // about its framing must not grow four lines about it the first time
        // somebody scrolls.
        const source = 'config {\n    showGrid: false\n}\ny = x';
        const { compiled, before, after } = open(source);
        after.graph = { viewport: { xmin: -20, xmax: 20, ymin: -8, ymax: 8 } };

        const { source: written } = write(compiled, before, after, source);

        assert.doesNotMatch(written, /xmin/);
        assert.match(written, /showGrid: false/);
    });

    test('does not open a config block on a pan alone', () => {
        const source = '// no settings at all\ny = x';
        const { compiled, before, after } = open(source);
        after.graph = { viewport: { xmin: -20, xmax: 20, ymin: -8, ymax: 8 } };

        const { edits, source: written } = write(compiled, before, after, source);

        assert.deepEqual(edits, []);
        assert.equal(written, source);
    });
});

describe('an expression Desmos grew on its own', () => {
    test('lands at the end of the script', () => {
        const source = '// a comment\ny = x';
        const { compiled, before, after } = open(source);
        after.expressions.push({ type: 'expression', id: '9', latex: 'z=3' });

        const { source: written } = write(compiled, before, after, source);
        assert.equal(written, '// a comment\ny = x\nz = 3');
    });

    test('lands inside the folder it belongs to', () => {
        const source = 'folder "Shapes" {\n    y = x\n}\n\nq = 1';
        const { compiled, before, after } = open(source);
        after.expressions.push({
            type: 'expression',
            id: '9',
            latex: 'z=3',
            folderId: 'folder_1',
        });

        const { source: written } = write(compiled, before, after, source);
        assert.equal(written, 'folder "Shapes" {\n    y = x\n    z = 3\n}\n\nq = 1');
    });

    test('is deleted from the script when it is deleted from the graph', () => {
        const source = '// a comment\ny = x\nz = 3';
        const { compiled, before, after } = open(source);
        after.expressions = after.expressions.filter(e => e.id !== 'expr_1');

        const { source: written } = write(compiled, before, after, source);
        assert.equal(written, '// a comment\nz = 3');
    });
});

describe('several changes at once', () => {
    test('are applied without one moving the lines of another', () => {
        const source = ['P = (1, 2)', '', '// keep me', 'Q = (3, 4)', '', 'R = (5, 6)'].join('\n');
        const { compiled, before, after } = open(source);
        // The first grows to a block, which would shift every line after it if
        // the edits were applied top-down.
        find(after, 'expr_1').latex = 'P=\\left(9,9\\right)';
        find(after, 'expr_2').latex = 'Q=\\left(8,8\\right)';
        find(after, 'expr_3').latex = 'R=\\left(7,7\\right)';

        const { source: written } = write(compiled, before, after, source);

        assert.equal(
            written,
            ['P = (9, 9)', '', '// keep me', 'Q = (8, 8)', '', 'R = (7, 7)'].join('\n'),
        );
    });

    test('come back ordered latest-first, so a host can apply them in turn', () => {
        const source = 'P = (1, 2)\nQ = (3, 4)\nR = (5, 6)';
        const { compiled, before, after } = open(source);
        find(after, 'expr_1').latex = 'P=\\left(9,9\\right)';
        find(after, 'expr_3').latex = 'R=\\left(7,7\\right)';

        const { edits } = write(compiled, before, after, source);
        assert.deepEqual(
            edits.map((edit: SourceEdit) => edit.line),
            [2, 0],
        );
    });
});
