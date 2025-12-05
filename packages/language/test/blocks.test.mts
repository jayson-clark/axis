import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { expandBlockEntries, insertMissingSeparators } from '../dist/index.js';

describe('expandBlockEntries', () => {
    test('spreads an inline block to one statement per line', () => {
        assert.deepEqual(expandBlockEntries(['table { x = [1, 2], y = [1, 4] }']), [
            'table {',
            'x = [1, 2]',
            'y = [1, 4]',
            '}',
        ]);
    });

    test('leaves a bracket that closes on the same line opaque', () => {
        assert.deepEqual(expandBlockEntries(['y = f(1, 2)']), ['y = f(1, 2)']);
    });

    test('keeps blank lines', () => {
        assert.deepEqual(expandBlockEntries(['y = x', '', 'z = 1']), ['y = x', '', 'z = 1']);
    });
});

describe('insertMissingSeparators', () => {
    test('adds the comma between two entries of a block', () => {
        assert.deepEqual(insertMissingSeparators(['table {', 'x = [1]', 'y = [2]', '}']), [
            'table {',
            'x = [1],',
            'y = [2]',
            '}',
        ]);
    });

    test('leaves the last entry before the closing bracket alone', () => {
        assert.deepEqual(insertMissingSeparators(['table {', 'x = [1]', '}']), [
            'table {',
            'x = [1]',
            '}',
        ]);
    });

    test('leaves top-level statements alone', () => {
        assert.deepEqual(insertMissingSeparators(['y = x', 'z = 1']), ['y = x', 'z = 1']);
    });
});
