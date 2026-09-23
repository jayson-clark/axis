import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { compileAxis } from '@axis-dsl/compiler';
import { readAxisFile } from '../dist/index.js';
import { example, skip, useCalculator } from './support.mts';

/** The built `axis-inspect`, run as an agent would run it. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** Run the CLI, resolving with its output and exit code rather than throwing on 1. */
async function inspect(...args: string[]): Promise<{ stdout: string; code: number }> {
    try {
        const { stdout } = await promisify(execFile)(process.execPath, [CLI, ...args]);
        return { stdout, code: 0 };
    } catch (error) {
        const failed = error as { stdout: string; code: number };
        return { stdout: failed.stdout, code: failed.code };
    }
}

describe('a real Desmos calculator', { skip }, () => {
    const calculator = useCalculator();

    describe('expression analysis', () => {
        test('accepts an expression Desmos can graph', async () => {
            await calculator().load('y = x^2');
            const [expression] = await calculator().inspectExpressions();

            assert.equal(expression.latex, 'y=x^{2}');
            assert.equal(expression.analysis?.isGraphable, true);
            assert.equal(expression.analysis?.isError, false);
        });

        test('reports the error Desmos gives for a broken expression', async () => {
            // Raw latex, since no Axis compiles to latex this broken: the
            // question is whether the harness passes Desmos' verdict on.
            await calculator().setExpressions([
                { type: 'expression', id: 'broken', latex: 'y=x^{2' },
            ]);
            const [error] = await calculator().getErrors();

            assert.ok(error, 'expected Desmos to reject the expression');
            assert.equal(error.index, 0);
            assert.match(error.message, /\S/);
        });

        test('evaluates a definition to a number', async () => {
            await calculator().load('a = 6 * 7');
            const [expression] = await calculator().inspectExpressions();

            assert.deepEqual(expression.analysis?.evaluation, { type: 'Number', value: 42 });
        });

        test('evaluates a list', async () => {
            await calculator().load('L = [1, 2, 3]');
            const [expression] = await calculator().inspectExpressions();

            assert.deepEqual(expression.analysis?.evaluation, {
                type: 'ListOfNumber',
                value: [1, 2, 3],
            });
        });

        test('resolves a function defined earlier in the file', async () => {
            await calculator().load('f(x) = 2x + 1\ny = f(x)');
            const errors = await calculator().getErrors();

            assert.deepEqual(errors, []);
        });

        test('catches a reference to something the file never defines', async () => {
            // The checker reports it too (`unknown-function`); the graph is
            // still applied, and Desmos rejects the expression on its own.
            const { diagnostics } = await calculator().load('y = undefinedFunction(x)');
            const errors = await calculator().getErrors();

            assert.deepEqual(
                diagnostics.map(diagnostic => diagnostic.code),
                ['unknown-function'],
            );
            assert.equal(errors.length, 1);
        });
    });

    describe('load', () => {
        test('applies the compiled state and options, and hands the compilation back', async () => {
            const source = 'config { degreeMode: true }\na = sin(90)';
            const compiled = await calculator().load(source);

            assert.deepEqual(compiled.state, compileAxis(source).state);
            assert.equal((await calculator().getSettings()).degreeMode, true);
            assert.equal((await calculator().evaluate('a')).numericValue, 1);
        });

        test('applies a file with diagnostics, as every host does', async () => {
            const { diagnostics } = await calculator().load('y = x @ color: red\nk = 5');

            assert.deepEqual(
                diagnostics.map(diagnostic => diagnostic.code),
                ['invalid-color'],
            );
            assert.equal((await calculator().evaluate('k')).numericValue, 5);
        });

        test('lays settings given to it over the file’s own', async () => {
            await calculator().load('config { showGrid: false }\ny = x', {
                settings: { showGrid: true },
            });

            assert.equal((await calculator().getSettings()).showGrid, true);
        });
    });

    describe('evaluate', () => {
        test('answers a query against the loaded graph', async () => {
            await calculator().load('a = 5\nf(x) = x^2');

            assert.equal((await calculator().evaluate('f(a)')).numericValue, 25);
        });

        test('answers a list query', async () => {
            await calculator().load('L = [1, 2, 3]');

            assert.deepEqual((await calculator().evaluate('2L')).listValue, [2, 4, 6]);
        });
    });

    describe('graph state', () => {
        test('puts a folder’s contents inside it', async () => {
            await calculator().load('folder "Curves" {\ny = x\n}');
            const [folder, child] = await calculator().inspectExpressions();

            assert.equal(folder.type, 'folder');
            assert.equal(folder.title, 'Curves');
            assert.equal(child.type, 'expression');

            const state = await calculator().getState();
            const inFolder = state.expressions?.list?.[1] as { folderId?: string };
            assert.equal(inFolder.folderId, folder.id);
        });

        test('carries a note through as text', async () => {
            await calculator().load('"Getting started"');
            const [note] = await calculator().inspectExpressions();

            assert.equal(note.type, 'text');
            assert.equal(note.text, 'Getting started');
        });

        test('applies a config block to the calculator settings', async () => {
            await calculator().load(
                'config {\n    degreeMode: true\n    showGrid: false\n}\ny = x',
            );
            const settings = await calculator().getSettings();

            assert.equal(settings.degreeMode, true);
            assert.equal(settings.showGrid, false);
        });

        test('degree mode is the calculator’s, not just the setting’s', async () => {
            await calculator().load('config {\n    degreeMode: true\n}\na = sin(90)');
            const [expression] = await calculator().inspectExpressions();

            assert.deepEqual(expression.analysis?.evaluation, { type: 'Number', value: 1 });
        });

        test('reset clears the graph', async () => {
            await calculator().load('y = x');
            await calculator().reset();

            assert.deepEqual(await calculator().getErrors(), []);
            const expressions = await calculator().inspectExpressions();
            assert.ok(expressions.every(expression => !expression.latex));
        });
    });

    describe('the example files', () => {
        // The tour in examples/ is what a newcomer reads first, so a broken
        // expression in one is worth catching here rather than in a screenshot.
        for (const name of [
            '01-basics.axis',
            '04-styling.axis',
            '10-tables.axis',
            '15-config.axis',
            '16-imports.axis',
        ]) {
            test(`${name} produces a graph Desmos accepts`, async () => {
                const file = await readAxisFile(example(name));
                await calculator().load(file.source, {
                    path: file.path,
                    resolveImport: file.resolveImport,
                    resolveImage: file.resolveImage,
                });

                assert.deepEqual(await calculator().getErrors(), []);
            });
        }
    });

    describe('screenshots', () => {
        test('captures the graphpaper as a PNG data URI', async () => {
            await calculator().load('y = x^2');
            const dataUri = await calculator().screenshot({ width: 200, height: 200 });

            assert.match(dataUri, /^data:image\/png;base64,/);
            assert.ok(dataUri.length > 1000);
        });
    });

    describe('axis-inspect', () => {
        test('reports a clean file and exits 0', async () => {
            const { stdout, code } = await inspect('-e', 'y = x ^ 2');

            assert.equal(code, 0);
            assert.match(stdout, /1 expression, 0 diagnostics, 0 errors/);
            assert.match(stdout, /graphable\s+y=x\^\{2\}/);
        });

        test('reports compile diagnostics next to Desmos errors, and exits 1', async () => {
            const { stdout, code } = await inspect('-e', 'mean = 3\ny = x @ color: red');

            assert.equal(code, 1);
            assert.match(stdout, /2 diagnostics, 1 error/);
            assert.match(stdout, /<inline>:1:1\s+error assign-to-builtin/);
            assert.match(stdout, /<inline>:2:16\s+error invalid-color/);
            assert.match(stdout, /error\s+\\operatorname\{mean\}=3/);
        });

        test('carries the diagnostics in its JSON', async () => {
            const { stdout } = await inspect('--json', '-e', 'y = x @ color: red');
            const inspection = JSON.parse(stdout) as {
                diagnostics: { code: string }[];
                errors: unknown[];
            };

            assert.deepEqual(
                inspection.diagnostics.map(diagnostic => diagnostic.code),
                ['invalid-color'],
            );
            assert.deepEqual(inspection.errors, []);
        });

        test('evaluates Axis against the graph it loaded', async () => {
            const { stdout } = await inspect('-e', 'f(x) = 2x + 1', '--eval', 'f(20)');

            assert.match(stdout, /41/);
        });

        test('reads a file, imports and all', async () => {
            const { stdout, code } = await inspect(example('16-imports.axis'));

            assert.equal(code, 0);
            assert.match(stdout, /0 diagnostics, 0 errors/);
        });
    });
});
