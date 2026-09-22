import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lineIndex } from '../dist/index.js';

describe('lineIndex', () => {
    const source = 'ab\ncde\n\nf';
    const index = lineIndex(source);

    test('counts lines, with a last line after the final newline', () => {
        assert.equal(index.lineCount, 4);
        assert.deepEqual(index.lineStarts, [0, 3, 7, 8]);
        assert.equal(lineIndex('').lineCount, 1);
        assert.equal(lineIndex('a\n').lineCount, 2);
    });

    test('offset to position, zero-based', () => {
        assert.deepEqual(index.positionAt(0), { line: 0, character: 0 });
        assert.deepEqual(index.positionAt(2), { line: 0, character: 2 });
        assert.deepEqual(index.positionAt(3), { line: 1, character: 0 });
        assert.deepEqual(index.positionAt(6), { line: 1, character: 3 });
        assert.deepEqual(index.positionAt(7), { line: 2, character: 0 });
        assert.deepEqual(index.positionAt(9), { line: 3, character: 1 });
    });

    test('position to offset, the inverse', () => {
        for (let offset = 0; offset <= source.length; offset++) {
            assert.equal(index.offsetAt(index.positionAt(offset)), offset);
        }
    });

    test('out of range is clamped', () => {
        assert.deepEqual(index.positionAt(-5), { line: 0, character: 0 });
        assert.deepEqual(index.positionAt(99), { line: 3, character: 1 });
        assert.equal(index.offsetAt({ line: 0, character: 99 }), 2);
        assert.equal(index.offsetAt({ line: 99, character: 0 }), source.length);
        assert.equal(index.offsetAt({ line: -1, character: 0 }), 0);
    });

    test('characters are UTF-16 code units', () => {
        const emoji = lineIndex('😀x\ny');
        assert.deepEqual(emoji.positionAt(2), { line: 0, character: 2 });
        assert.deepEqual(emoji.positionAt(4), { line: 1, character: 0 });
    });
});
