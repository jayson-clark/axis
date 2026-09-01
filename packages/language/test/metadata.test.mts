import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitTopLevel, splitTopLevelParts, splitTrailingMetadata } from '../dist/index.js';

describe('splitTrailingMetadata', () => {
    test('splits a `# key: value` run off the statement', () => {
        assert.deepEqual(splitTrailingMetadata('y = x # color: red'), {
            code: 'y = x',
            metadata: 'color: red',
        });
    });

    test('leaves a `#` that opens no properties alone', () => {
        assert.deepEqual(splitTrailingMetadata('y = x # ff0000'), {
            code: 'y = x # ff0000',
            metadata: undefined,
        });
    });

    test('recognises the bare flags', () => {
        for (const flag of ['hidden', 'secret']) {
            assert.deepEqual(splitTrailingMetadata(`y = x # ${flag}`), {
                code: 'y = x',
                metadata: flag,
            });
        }
    });

    test('leaves a `#` inside a string alone, since a string is text', () => {
        assert.deepEqual(splitTrailingMetadata('"step #1: begin"'), {
            code: '"step #1: begin"',
            metadata: undefined,
        });
        assert.deepEqual(splitTrailingMetadata('(0, 0) # label: "step #1"'), {
            code: '(0, 0)',
            metadata: 'label: "step #1"',
        });
    });

    test('leaves a line with no `#` untouched', () => {
        assert.deepEqual(splitTrailingMetadata('y = x'), { code: 'y = x', metadata: undefined });
    });
});

describe('splitTopLevel', () => {
    test('ignores separators nested in brackets', () => {
        assert.deepEqual(splitTopLevel('a: (1, 2), b: 3', ','), ['a: (1, 2)', ' b: 3']);
    });

    test('ignores separators inside quotes', () => {
        assert.deepEqual(splitTopLevel('label: "a, b", color: red', ','), [
            'label: "a, b"',
            ' color: red',
        ]);
    });

    test('reports where each part started', () => {
        assert.deepEqual(splitTopLevelParts('ab,cd', ','), [
            { text: 'ab', start: 0 },
            { text: 'cd', start: 3 },
        ]);
    });
});
