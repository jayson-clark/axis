import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getAxisCompletions } from '../dist/index.js';

const labels = (source: string, line: number, character: number) =>
    getAxisCompletions(source, { line, character }).map(item => item.label);

describe('getAxisCompletions', () => {
    test('offers only config properties inside a config block', () => {
        const offered = labels('config {\n    ', 1, 4);
        assert.ok(offered.includes('showGrid'));
        assert.ok(!offered.includes('sin'));
    });

    test('offers only metadata properties after a `#`', () => {
        const offered = labels('y = x # ', 0, 8);
        assert.ok(offered.includes('color'));
        assert.ok(!offered.includes('sin'));
    });

    test('offers builtins, constants and keywords at the top level', () => {
        const offered = labels('', 0, 0);
        for (const expected of ['sin', 'pi', 'folder', 'table', 'config']) {
            assert.ok(offered.includes(expected), `expected ${expected}`);
        }
    });

    test('offers the names the document itself defines', () => {
        const offered = labels('f(x) = x^2\nk = 3\n', 2, 0);
        assert.ok(offered.includes('f'));
        assert.ok(offered.includes('k'));
    });

    test('offers each name once', () => {
        const offered = labels('f(x) = x\nf(x) = x\n', 2, 0);
        assert.equal(new Set(offered).size, offered.length);
    });

    test('leaves the config block once it closes', () => {
        const offered = labels('config {\n}\n', 2, 0);
        assert.ok(offered.includes('sin'));
    });
});
