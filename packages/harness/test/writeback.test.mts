// ═════════════════════════════════════════════════════════════════════════════
// Writing a real calculator's changes back into the script
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler's own write-back tests build the "after" snapshot by hand, which
// tests the logic and nothing about Desmos. This tests the other half: that the
// state a real calculator hands back is one the write-back reads correctly.
//
// That gap is not theoretical. Desmos leaves a property off the state when it
// matches its own default, so a slider written `{min: 0, max: 10}` comes back
// carrying only the min - and a write-back that rewrote statements from what
// the calculator returned would take `max: 10` out of the script as the price
// of dragging the slider. The merge is what stops that, and this is the only
// place that can say whether it works.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applySourceEdits, compileAxis, diffGraphs, writeBackGraph } from '@axis-dsl/compiler';
import type { GraphSnapshot } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';

const PATH = 'main.axis';

/**
 * What the v1 write-back reads: a v1 compilation, which `compileAxis` no longer
 * returns. The suite is held until #24 ports the write-back onto the v2 result;
 * until then it is typed against what it was written for, and skipped.
 */
type LegacyCompilation = Parameters<typeof writeBackGraph>[0];
const compileLegacy = (source: string, options: { path: string }) =>
    compileAxis(source, options) as unknown as LegacyCompilation;

describe('writing a live graph back', { skip: skip || 'the v1 write-back awaits #24' }, () => {
    const calculator = useCalculator();

    /**
     * Load a script and take the graph the calculator holds, which is the
     * baseline every later reading is compared against.
     *
     * Deliberately not the compilation: Desmos normalises what it is given, so
     * comparing against what was sent would report a change on every
     * expression the moment the graph loaded.
     */
    async function load(source: string) {
        await calculator().load(source);
        const compiled = compileLegacy(source, { path: PATH });
        return { compiled, before: await snapshot() };
    }

    async function snapshot(): Promise<GraphSnapshot> {
        const state = await calculator().getState();
        const held = state.expressions ?? { list: [] };

        return {
            expressions: (held.list ?? []) as GraphSnapshot['expressions'],
            graph: state.graph,
            ticker: held.ticker,
        };
    }

    /**
     * Change one expression's latex on the live graph, which is what a drag
     * does and all a drag does.
     *
     * `setExpression` rather than re-applying the list: it merges into the
     * expression that is there, leaving everything else about it alone - and
     * the point of these tests is what Desmos keeps hold of, so putting the
     * list back through an accessor that normalises it would be testing the
     * accessor instead.
     */
    async function setLatex(id: string, latex: string) {
        await calculator().page.evaluate(
            ([expressionId, value]) => {
                const harness = (
                    globalThis as {
                        __axisHarness?: { calculator: { setExpression(state: object): void } };
                    }
                ).__axisHarness;
                harness?.calculator.setExpression({ id: expressionId, latex: value });
            },
            [id, latex] as const,
        );
    }

    function write(
        compiled: LegacyCompilation,
        before: GraphSnapshot,
        after: GraphSnapshot,
        source: string,
    ) {
        const result = writeBackGraph(compiled, before, after, new Map([[PATH, source]]));
        return { ...result, source: applySourceEdits(source, result.edits) };
    }

    test('a moved point is written back, and nothing else is', async () => {
        const source = [
            '// the curve',
            'y = x^2 # color: #c74440',
            '',
            '// the handle',
            'P = (1, 2) # dragMode: XY',
        ].join('\n');
        const { compiled, before } = await load(source);

        await setLatex('expr_2', 'P=\\left(4,5\\right)');
        const { source: written, skipped } = write(compiled, before, await snapshot(), source);

        assert.deepEqual(skipped, []);
        assert.equal(written.split('\n')[4], 'P = (4, 5) # dragMode: XY');
        assert.equal(written.split('\n')[1], 'y = x^2 # color: #c74440');
    });

    test('a dragged slider keeps the bound Desmos did not hand back', async () => {
        const source = 'a = 1 # sliderBounds: {min: 0, max: 10}';
        const { compiled, before } = await load(source);

        // Exactly what dragging the slider does: the value changes, and
        // nothing else about the expression is touched.
        await setLatex('expr_1', 'a=6.25');
        const after = await snapshot();

        // The finding this test exists for: `max` is not in what came back.
        const live = after.expressions.find(e => e.id === 'expr_1') as {
            slider?: Record<string, unknown>;
        };
        assert.equal(live.slider?.max, undefined, 'Desmos started returning the default max');

        const { source: written } = write(compiled, before, after, source);

        assert.match(written, /a = 6\.25/);
        assert.match(written, /max: 10/);
        assert.deepEqual(
            compileLegacy(written, { path: PATH }).expressions[0],
            compiled.expressions[0] && { ...compiled.expressions[0], latex: 'a=6.25' },
        );
    });

    test('a graph nobody touched produces no changes at all', async () => {
        const source = [
            'config {',
            '    xmin: -5',
            '    xmax: 5',
            '}',
            '',
            'y = x^2 # color: #c74440, lineStyle: DASHED',
            'P = (1, 2) # dragMode: XY, pointStyle: CROSS',
            '"a note"',
            '',
            'folder "Shapes" {',
            '    z = 3',
            '}',
        ].join('\n');
        const { before } = await load(source);

        // The same reading twice. Anything reported here is the loop finding
        // work in its own output, which is what would make it rewrite a file
        // on a timer with nobody touching anything.
        assert.deepEqual(diffGraphs(before, await snapshot()), []);
    });
});
