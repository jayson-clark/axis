import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readAxisFile } from '../dist/index.js';
import { example, skip, useCalculator } from './support.mts';

describe('a real Desmos calculator', { skip }, () => {
    const calculator = useCalculator();

    describe('expression analysis', () => {
        test('accepts an expression Desmos can graph', async () => {
            await calculator().load('y = x^2');
            const [expression] = await calculator().inspectExpressions();

            assert.equal(expression.latex, 'y=x^2');
            assert.equal(expression.analysis?.isGraphable, true);
            assert.equal(expression.analysis?.isError, false);
        });

        test('reports the error Desmos gives for a broken expression', async () => {
            await calculator().load('y = x^{2');
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

        test('resolves a function defined earlier in the script', async () => {
            await calculator().load('f(x) = 2x + 1\ny = f(x)');
            const errors = await calculator().getErrors();

            assert.deepEqual(errors, []);
        });

        test('catches a reference to something the script never defines', async () => {
            await calculator().load('y = undefinedFunction(x)');
            const errors = await calculator().getErrors();

            assert.equal(errors.length, 1);
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
                'config {\n    degreeMode: true,\n    showGrid: false\n}\ny = x',
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

    describe('the example scripts', () => {
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
                const script = await readAxisFile(example(name));
                await calculator().load(script.source, {
                    path: script.path,
                    resolveImport: script.resolveImport,
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
});
