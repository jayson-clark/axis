// ═════════════════════════════════════════════════════════════════════════════
// Writing a real calculator's changes back into the file
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler's own write-back tests build the "after" reading by hand, which
// tests the logic and nothing about Desmos. This tests the other half: that the
// graph a real calculator hands back is one the write-back reads correctly, and
// that the file it writes builds that graph again.
//
// That gap is not theoretical. Desmos leaves a property off the state when it
// matches its own default, so a slider written `0..10` comes back carrying only
// the min - and a write-back that rewrote statements from what the calculator
// returned would take the max out of the file as the price of dragging the
// slider. The merge is what stops that, and this is the only place that can
// say whether it works.
//
// Every case goes all the way round: load a file, change the live graph the
// way a person would, write the change back, load what was written, and ask
// the calculator whether it holds the change.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applySourceEdits, compileAxis, diffGraphs, writeBackGraph } from '@axis-dsl/compiler';
import type { CompilationResult, GraphSnapshot } from '@axis-dsl/compiler';
import type { Point } from '@axis-dsl/desmos';
import { skip, useCalculator } from './support.mts';

const PATH = 'main.axis';

type Item = Record<string, unknown>;

describe('writing a live graph back', { skip }, () => {
    const calculator = useCalculator();

    /**
     * Load a file and take the graph the calculator holds, which is the
     * baseline every later reading is compared against.
     *
     * Deliberately not the compilation: Desmos normalises what it is given, so
     * comparing against what was sent would report a change on every
     * expression the moment the graph loaded.
     */
    async function load(source: string) {
        const compiled = await calculator().load(source, { path: PATH });
        return { source, compiled, before: await calculator().getGraph() };
    }

    /** Change one expression on the live graph through Desmos' own accessor. */
    async function setExpression(state: Item) {
        await calculator().page.evaluate(expression => {
            const harness = (
                globalThis as {
                    __axisHarness?: { calculator: { setExpression(state: object): void } };
                }
            ).__axisHarness;
            harness?.calculator.setExpression(expression);
        }, state);
        await calculator().settle();
    }

    /**
     * Drag with a real mouse, from one point of the graphpaper to another -
     * what a person does to a movable point, down to Desmos snapping it.
     */
    async function drag(from: Point, to: Point) {
        const page = calculator().page;
        const [start, end] = await page.evaluate(
            ([a, b]) => {
                const live = (
                    globalThis as {
                        __axisHarness?: {
                            calculator: { mathToPixels(point: Point): { x: number; y: number } };
                        };
                    }
                ).__axisHarness!.calculator;
                return [live.mathToPixels(a), live.mathToPixels(b)];
            },
            [from, to] as const,
        );
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        for (let step = 1; step <= 10; step++) {
            await page.mouse.move(
                start.x + ((end.x - start.x) * step) / 10,
                start.y + ((end.y - start.y) * step) / 10,
            );
        }
        await page.mouse.up();
        await calculator().settle();
    }

    /** Write back what changed since `before`, and apply it to the file. */
    async function write(opened: {
        source: string;
        compiled: CompilationResult;
        before: GraphSnapshot;
    }) {
        const after = await calculator().getGraph();
        const { source, before, compiled } = opened;
        const result = writeBackGraph(source, { before, after }, compiled, { path: PATH });
        return { ...result, after, written: applySourceEdits(opened.source, result.edits) };
    }

    /** The expression with this id in a reading. */
    function item(reading: GraphSnapshot, id: string): Item {
        const found = reading.state.expressions?.list?.find(candidate => candidate.id === id);
        assert.ok(found, `no expression ${id}`);
        return found as unknown as Item;
    }

    /**
     * Load what was written into the calculator and compare the graph it
     * builds with the one the change left behind - the whole point of the
     * exercise. Ids line up because nothing was added or removed.
     */
    async function reloads(written: string, after: GraphSnapshot, ids: readonly string[]) {
        assert.deepEqual(
            compileAxis(written, { path: PATH }).diagnostics.filter(d => d.severity === 'error'),
            [],
        );
        await calculator().load(written, { path: PATH });
        const reloaded = await calculator().getGraph();
        for (const id of ids) {
            assert.deepEqual(item(reloaded, id), item(after, id), `${id} is not what was changed`);
        }
        assert.deepEqual(await calculator().getErrors(), []);
    }

    test('a dragged point is written back, and nothing else', async () => {
        const opened = await load(
            [
                '// the curve',
                'y = x^2 @ color: RED',
                '',
                '// the handle',
                'P = (1, 2) @ dragMode: XY',
            ].join('\n'),
        );

        await drag({ x: 1, y: 2 }, { x: 4, y: -3 });
        const { written, skipped, after } = await write(opened);

        assert.deepEqual(skipped, []);
        const moved = item(after, 'expr_2').latex as string;
        assert.notEqual(moved, 'P=\\left(1,2\\right)', 'the drag did not move the point');
        const [, x, y] = /\\left\((-?[\d.]+),(-?[\d.]+)\\right\)/.exec(moved) ?? [];
        assert.equal(
            written,
            [
                '// the curve',
                'y = x^2 @ color: RED',
                '',
                '// the handle',
                `P = (${x}, ${y}) @ dragMode: XY`,
            ].join('\n'),
        );
        await reloads(written, after, ['expr_1', 'expr_2']);
    });

    test('a dragged slider keeps the bound Desmos did not hand back', async () => {
        const opened = await load('a = 1 @ slider: 0..10');

        // The finding this test exists for: the max is not in what came back.
        const slider = item(opened.before, 'expr_1').slider as Item;
        assert.equal(slider.min, '0');
        assert.equal(slider.max, undefined, 'Desmos started returning its default max');

        // Exactly what dragging the slider does: the value changes, and
        // nothing else about the expression is touched.
        await setExpression({ id: 'expr_1', latex: 'a=6.25' });
        const { written, after } = await write(opened);

        assert.equal(written, 'a = 6.25 @ slider: 0..10');
        await reloads(written, after, ['expr_1']);
        assert.equal((await calculator().evaluate('a')).numericValue, 6.25);
    });

    test('a recolour is written as the colour Desmos picked it from', async () => {
        const opened = await load('y = x ^ 2 @ color: RED, lineWidth: 3');

        await setExpression({ id: 'expr_1', color: '#2d70b3' });
        const { written, after } = await write(opened);

        assert.equal(written, 'y = x ^ 2 @ color: BLUE, lineWidth: 3');
        await reloads(written, after, ['expr_1']);
    });

    test('new slider bounds are written into the range, end by end', async () => {
        const opened = await load('b = 2 @ slider: 0..10 step 0.5');

        await setExpression({ id: 'expr_1', sliderBounds: { min: '-5', max: '20', step: '0.5' } });
        const { written, after } = await write(opened);

        assert.equal(written, 'b = 2 @ slider: -5..20 step 0.5');
        await reloads(written, after, ['expr_1']);
    });

    test('a folder, a note and a table cell are each written where they were', async () => {
        const opened = await load(
            [
                'folder "Points" {',
                '    P = (1, 2) // here',
                '}',
                '"a note"',
                'table { x = [1, 2]; y_1 = [3, 4] }',
            ].join('\n'),
        );

        await setExpression({ id: 'expr_2', latex: 'P=\\left(3,3\\right)' });
        await setExpression({ id: 'note_3', text: 'a better note' });
        const table = item(opened.before, 'table_6') as { columns: Item[] };
        await calculator().page.evaluate(
            columns => {
                const harness = (
                    globalThis as {
                        __axisHarness?: { calculator: { setExpression(state: object): void } };
                    }
                ).__axisHarness;
                harness?.calculator.setExpression({ id: 'table_6', type: 'table', columns });
            },
            [table.columns[0], { ...table.columns[1], values: ['3', '9'] }],
        );
        await calculator().settle();

        const { written, after, skipped } = await write(opened);
        assert.deepEqual(skipped, []);
        assert.equal(
            written,
            [
                'folder "Points" {',
                '    P = (3, 3) // here',
                '}',
                '"a better note"',
                'table { x = [1, 2]; y_1 = [3, 9] }',
            ].join('\n'),
        );
        await reloads(written, after, ['expr_2', 'note_3', 'table_6']);
    });

    test('a setting is written into the config block the file has', async () => {
        const opened = await load('config {\n    showGrid: true\n}\ny = x');

        await calculator().updateSettings({ showGrid: false });
        const { written } = await write(opened);

        assert.equal(written, 'config {\n    showGrid: false\n}\ny = x');
        await calculator().load(written, { path: PATH });
        assert.equal((await calculator().getSettings()).showGrid, false);
    });

    test('a pan is written for a file that framed itself', async () => {
        const opened = await load(
            'config {\n    xmin: -5\n    xmax: 5\n    ymin: -5\n    ymax: 5\n}\ny = x',
        );

        await calculator().setMathBounds({ left: -20, right: 20, bottom: -8, top: 8 });
        const { written, after } = await write(opened);

        const viewport = after.state.graph!.viewport!;
        assert.match(written, new RegExp(`xmin: ${viewport.xmin}\\b`));
        await calculator().load(written, { path: PATH });
        assert.deepEqual((await calculator().getGraph()).state.graph?.viewport, viewport);
    });

    test('an animating slider is refused by name', async () => {
        const opened = await load('s = 0.35 @ slider: 0..1, playing');

        // A playing slider re-numbers itself: the reading after any wait is
        // different, and none of it is anybody's edit.
        await new Promise(resolve => setTimeout(resolve, 300));
        const { edits, skipped } = await write(opened);

        assert.deepEqual(edits, []);
        assert.ok(skipped.length > 0, 'the slider did not move');
        assert.match(skipped[0].reason, /slider is animating/);
    });

    test('a graph nobody touched writes nothing at all', async () => {
        const opened = await load(
            [
                'config {',
                '    xmin: -5',
                '    xmax: 5',
                '}',
                '',
                'style s { color: RED }',
                'a = 1 @ slider: 0..10',
                'y = x^2 @ use: s, lineStyle: DASHED',
                'P = (1, 2) @ dragMode: XY, pointStyle: CROSS',
                '"a note"',
                '',
                'folder "Shapes" { @ collapsed',
                '    z = 3',
                '}',
                'table { x = [1, 2]; y_1 = [3, 4] }',
            ].join('\n'),
        );

        // The same reading twice. Anything reported here is the loop finding
        // work in its own output, which is what would make it rewrite a file
        // on a timer with nobody touching anything.
        const again = await calculator().getGraph();
        assert.deepEqual(diffGraphs(opened.before, again), []);
        assert.deepEqual((await write(opened)).edits, []);
    });
});
