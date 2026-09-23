// ═════════════════════════════════════════════════════════════════════════════
// Diagnostics, and the graph a file with a mistake in it still makes
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler never throws on anything a file can say (spec §8): it reports
// every problem it finds and hands back whatever graph it could still build, so
// a preview keeps drawing the parts of a file that are fine while one line
// is being typed. Both halves of that are promises, and the second is only
// checkable against a calculator - a value that is wrong has to be *left off*,
// not written out for Desmos to choke on, and one bad statement must not take
// its neighbours down with it.
//
// So each case below is one mistake followed by the same healthy remainder, and
// asserts both the diagnostics the mistake produces - each code with the text
// its span covers, so a diagnostic pointing at the wrong thing fails too - and
// that the remainder reached Desmos intact.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Expression } from '@axis-dsl/desmos';
import { compileAxis, type CompileOptions } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';

interface DiagnosticCase {
    source: string;
    /** Each diagnostic as its code and the source its span covers. */
    expected: [code: string, text: string][];
    /**
     * Set when the mistake still reaches the graph as a statement Desmos then
     * rejects - `mean = 3` is still written, since it can be, and Desmos says
     * `mean` is a function. Otherwise the graph must hold no errors at all:
     * whatever was wrong was left off or left out.
     */
    rejected?: true;
    options?: CompileOptions;
}

/** Appended to every case: what has to survive whatever came before it. */
const REMAINDER = 'ok = 42\ny = 2x @ color: #2d70b3, lineWidth: 4';

const CASES: Record<string, DiagnosticCase> = {
    // ── expressions ──────────────────────────────────────────────────────────
    'assign-to-builtin': {
        source: 'mean = 3',
        expected: [['assign-to-builtin', 'mean']],
        rejected: true,
    },
    'unknown-function': {
        source: 'y = notAFunction(x)',
        expected: [['unknown-function', 'notAFunction']],
        rejected: true,
    },
    'unknown-function, for a long name that cannot be a product': {
        source: 'y = sine(x)',
        expected: [['unknown-function', 'sine']],
        rejected: true,
    },
    'multiple-subscripts': {
        source: 'x_1_2 = 3',
        expected: [['multiple-subscripts', 'x_1_2']],
        rejected: true,
    },
    // Desmos takes `t_{rue}` for a variable nobody defined and says nothing,
    // which is exactly why the checker has to.
    'boolean-in-expression': {
        source: 'k = true',
        expected: [['boolean-in-expression', 'true']],
    },
    'dt-outside-ticker': {
        source: 'k = dt',
        expected: [['dt-outside-ticker', 'dt']],
        rejected: true,
    },
    'unexpected-string': {
        source: 'k = "hello" + 1',
        expected: [['unexpected-string', '"hello"']],
    },

    // ── properties ───────────────────────────────────────────────────────────
    'invalid-color, a palette name in the wrong case': {
        source: 'y = x @ color: red',
        expected: [['invalid-color', 'red']],
    },
    'invalid-color, a number': {
        source: 'y = x @ color: 3',
        expected: [['invalid-color', '3']],
    },
    'expected-expression, a value cut short': {
        source: 'y = x @ lineWidth: 2 +',
        expected: [['expected-expression', '']],
    },
    'unknown-property': {
        source: 'y = x @ bogus: 1',
        expected: [['unknown-property', 'bogus']],
    },
    'misplaced-property': {
        source: 'y = x @ collapsed',
        expected: [['misplaced-property', 'collapsed']],
    },
    'misplaced-property, through a style': {
        source: 'style s { showLabel }\ntable { x = [1]; y = [2] @ use: s }',
        expected: [['misplaced-property', 's']],
    },
    'duplicate-property': {
        source: 'y = x @ hidden, hidden',
        expected: [['duplicate-property', 'hidden']],
    },
    'invalid-value, a number for a string': {
        source: '(1, 2) @ label: 3',
        expected: [['invalid-value', '3']],
    },
    'invalid-value, a step on a domain': {
        source: '(cos(t), sin(t)) @ domain: 0..1 step 0.1',
        expected: [['invalid-value', '0..1 step 0.1']],
    },
    'invalid-value, a config boolean': {
        source: 'config { showGrid: 3 }',
        expected: [['invalid-value', '3']],
    },
    'invalid-enum': {
        source: 'y = x @ lineStyle: WAVY',
        expected: [['invalid-enum', 'WAVY']],
    },
    'unexpected-range': {
        source: 'y = x @ lineWidth: 1..2',
        expected: [['unexpected-range', '1..2']],
    },

    // ── structure ────────────────────────────────────────────────────────────
    'invalid-column': {
        source: 'table { x = 5 }',
        expected: [['invalid-column', 'x = 5']],
    },
    'nested-folder': {
        source: 'folder "a" {\n    folder "b" { k = 1 }\n}',
        expected: [['nested-folder', 'folder']],
    },
    'misplaced-config': {
        source: 'folder "f" { config { showGrid: false } }',
        expected: [['misplaced-config', 'config']],
    },
    'misplaced-ticker': {
        source: 'folder "f" { ticker ok -> 0 }',
        expected: [['misplaced-ticker', 'ticker']],
    },
    'misplaced-style': {
        source: 'folder "f" { style s { color: RED } }',
        expected: [['misplaced-style', 'style']],
    },
    'misplaced-macro': {
        source: 'folder "f" { macro M = 1 }',
        expected: [['misplaced-macro', 'macro']],
    },
    'duplicate-config': {
        source: 'config { showGrid: false }\nconfig { showGrid: true }',
        expected: [['duplicate-config', 'config']],
    },
    'duplicate-ticker': {
        source: 'k = 0\nticker k -> 1\nticker k -> 2',
        expected: [['duplicate-ticker', 'ticker']],
    },

    // ── macros ───────────────────────────────────────────────────────────────
    'duplicate-macro': {
        source: 'macro M = 1\nmacro M = 2\nk = M',
        expected: [['duplicate-macro', 'M']],
    },
    'macro-collision': {
        source: 'macro sin = 1\nk = sin(0)',
        expected: [['macro-collision', 'sin']],
    },
    // The call is left as written, and Desmos reads `F(1, 2)` as the
    // variable F times a point without complaint - silence again.
    'macro-arity': {
        source: 'macro F(a) = a\nk = F(1, 2)',
        expected: [['macro-arity', 'F(1, 2)']],
    },
    'macro-recursion': {
        source: 'macro A = B\nmacro B = A\nk = A',
        expected: [
            ['macro-recursion', 'A'],
            ['macro-recursion', 'B'],
        ],
    },

    // ── styles ───────────────────────────────────────────────────────────────
    'duplicate-style': {
        source: 'style s { color: RED }\nstyle s { color: BLUE }\ny = x @ use: s',
        expected: [['duplicate-style', 's']],
    },
    'unknown-style': {
        source: 'y = x @ use: nothing',
        expected: [['unknown-style', 'nothing']],
    },
    'style-cycle': {
        source: 'style a { use: b }\nstyle b { use: a }\ny = x @ use: a',
        expected: [['style-cycle', 'a']],
    },

    // ── files ────────────────────────────────────────────────────────────────
    'unresolved-import': {
        source: 'import "nowhere"',
        expected: [['unresolved-import', '"nowhere"']],
        options: { path: '/graph.axis', resolveImport: () => undefined },
    },
    'unresolved-image': {
        source: 'image "./missing.png"',
        expected: [['unresolved-image', '"./missing.png"']],
        options: { path: '/graph.axis', resolveImage: () => undefined },
    },
    'invalid-image': {
        source: 'image "./notes.txt"',
        expected: [['invalid-image', '"./notes.txt"']],
    },

    // ── syntax ───────────────────────────────────────────────────────────────
    'unexpected-character': {
        source: 'y = x $ 2',
        expected: [['unexpected-character', '$']],
    },
    'unterminated-string': {
        source: '"a note never closed',
        expected: [['unterminated-string', '"a note never closed']],
    },
    'invalid-color, a hex that is not one': {
        source: 'y = x @ color: #ff00',
        expected: [['invalid-color', '#ff00']],
    },
    'unclosed-bracket': {
        source: 'y = (x + 1',
        expected: [['unclosed-bracket', '(']],
    },
    'misplaced-metadata': {
        source: 'y = x\n@ hidden',
        expected: [['misplaced-metadata', '@']],
    },
    'comma-between-properties': {
        source: 'config { degreeMode: true, showGrid: false }',
        expected: [['comma-between-properties', ',']],
    },
};

describe('diagnostics', { skip }, () => {
    const calculator = useCalculator();

    for (const [name, { source, expected, rejected, options }] of Object.entries(CASES)) {
        test(`${name}: reported, and the rest of the file still graphs`, async () => {
            const whole = `${source}\n${REMAINDER}`;
            const { diagnostics } = await calculator().load(whole, options);

            assert.deepEqual(
                diagnostics.map(diagnostic => [
                    diagnostic.code,
                    whole.slice(diagnostic.span.start, diagnostic.span.end),
                ]),
                expected,
            );
            assert.ok(
                diagnostics.every(diagnostic => diagnostic.severity === 'error'),
                'every one of them is an error',
            );

            // The remainder, intact.
            assert.equal((await calculator().evaluate('ok')).numericValue, 42);
            const list = ((await calculator().getState()).expressions?.list ?? []) as Expression[];
            const line = list.find(item => item.latex === 'y=2x');
            assert.equal(line?.color, '#2d70b3');
            assert.equal(line?.lineWidth, '4');

            // And the mistake either left off, or the one thing Desmos rejects.
            const errors = await calculator().getErrors();
            if (rejected) {
                assert.equal(errors.length, 1, JSON.stringify(errors));
                assert.notEqual(errors[0].latex, 'y=2x');
            } else {
                assert.deepEqual(errors, []);
            }
        });
    }

    test('a wrong value is left off, and its statement keeps everything else', async () => {
        const { diagnostics } = await calculator().load(
            'y = x @ color: red, lineStyle: WAVY, lineWidth: 5, label: 3, showLabel',
        );
        const [line] = ((await calculator().getState()).expressions?.list ?? []) as Expression[];

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['invalid-color', 'invalid-enum', 'invalid-value'],
        );
        assert.equal(line.colorLatex, undefined);
        assert.equal(line.lineStyle, undefined);
        assert.equal(line.label, undefined);
        assert.equal(line.lineWidth, '5');
        assert.equal(line.showLabel, true);
    });

    test('a misplaced config is not applied', async () => {
        await calculator().load('folder "f" { config { showGrid: false } }');

        assert.equal((await calculator().getSettings()).showGrid, true);
    });

    test('a second config is reported, and merged over the first', async () => {
        // Unlike a second ticker, where the first stands: the diagnostic asks
        // for the two blocks to be merged, and the graph is drawn as if they
        // had been.
        await calculator().load(
            'config { showGrid: false; xAxisLabel: "t" }\nconfig { showGrid: true; degreeMode: true }',
        );
        const settings = await calculator().getSettings();

        assert.equal(settings.xAxisLabel, 't');
        assert.equal(settings.showGrid, true);
        assert.equal(settings.degreeMode, true);
    });

    test('a diagnostic about an imported file says which file', () => {
        const { diagnostics } = compileAxis('import "lib"\nk = 1', {
            path: '/graph.axis',
            resolveImport: () => ({ path: '/lib.axis', source: 'mean = 3' }),
        });

        assert.deepEqual(
            diagnostics.map(({ code, path, span }) => ({ code, path, span })),
            [{ code: 'assign-to-builtin', path: '/lib.axis', span: { start: 0, end: 4 } }],
        );
    });

    test('many mistakes at once are each reported, once', async () => {
        const { diagnostics } = await calculator().load(
            'mean = 3\ny = notAFunction(x)\ny = x @ color: red\nk = dt\n' + REMAINDER,
        );

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['assign-to-builtin', 'unknown-function', 'invalid-color', 'dt-outside-ticker'],
        );
        assert.equal((await calculator().evaluate('ok')).numericValue, 42);
    });

    test('an undefined variable is not a mistake of the file\u2019s', async () => {
        // Desmos flags it until it is defined, and offers to define it as a
        // slider - which is the author's move to make, not the compiler's.
        const { diagnostics } = await calculator().load('y = m * x');
        const [error] = await calculator().getErrors();

        assert.deepEqual(diagnostics, []);
        assert.match(error.message, /defining 'm'/);
    });

    test(
        'theta = 1 is reported, since Desmos will not define it',
        {
            todo: 'the checker is silent on `theta = 1` (spec §5.5 makes it a definition outside polar mode), and Desmos rejects it in every mode',
        },
        async () => {
            const { diagnostics } = await calculator().load('theta = 1');

            assert.equal((await calculator().getErrors()).length, 1);
            assert.equal(diagnostics.length, 1);
        },
    );
});
