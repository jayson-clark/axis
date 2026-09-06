import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bracketDelta, joinContinuedLines, leadingClosers } from '../dist/index.js';

describe('bracketDelta', () => {
    test('counts what a line leaves open', () => {
        assert.equal(bracketDelta('f(x) = ('), 1);
        assert.equal(bracketDelta('  })'), -2);
        assert.equal(bracketDelta('y = (x + 1)'), 0);
    });

    test('ignores brackets inside strings and comments', () => {
        assert.equal(bracketDelta('"a ( b"'), 0);
        assert.equal(bracketDelta('y = x // a ( here'), 0);
    });

    test('honours a restricted opener set', () => {
        assert.equal(bracketDelta('table {', '(['), 0);
    });
});

describe('leadingClosers', () => {
    test('counts only the closers a line opens with', () => {
        assert.equal(leadingClosers('  }) x'), 2);
        assert.equal(leadingClosers('x }'), 0);
    });
});

describe('joinContinuedLines', () => {
    test('folds a list split over several lines back into one statement', () => {
        assert.deepEqual(joinContinuedLines('P = [\n  (0,0),\n  (4,0)\n]\ny = x'), [
            'P = [ (0,0), (4,0) ]',
            'y = x',
        ]);
    });

    test('does not join a block brace', () => {
        assert.deepEqual(joinContinuedLines('table {\ny = x\n}'), ['table {', 'y = x', '}']);
    });

    test('folds a piecewise whose brace ends the line', () => {
        // The formatter breaks a long piecewise this way, so it has to read
        // back as one statement - a trailing brace is not by itself a block.
        assert.deepEqual(joinContinuedLines('y = {\n  x < 0: -x,\n  x >= 0: x\n}\nz = 1'), [
            'y = { x < 0: -x, x >= 0: x }',
            'z = 1',
        ]);
    });

    test('still does not join a folder brace that ends the line', () => {
        assert.deepEqual(joinContinuedLines('folder "F" {\ny = x\n}'), [
            'folder "F" {',
            'y = x',
            '}',
        ]);
    });

    test('re-attaches metadata written on any line the statement spans', () => {
        assert.deepEqual(joinContinuedLines('P = [\n(0,0) # color: red\n]'), [
            'P = [ (0,0) ] # color: red',
        ]);
    });
});
