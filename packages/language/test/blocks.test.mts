import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    expandBlockEntries,
    foldMetadataBlocks,
    insertMissingSeparators,
    metadataBlockLines,
} from '../dist/index.js';

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

describe('foldMetadataBlocks', () => {
    test('folds a block onto the statement it annotates', () => {
        assert.equal(
            foldMetadataBlocks('y = x #{\n    color: red\n    lineWidth: 3\n}'),
            'y = x # color: red, lineWidth: 3',
        );
    });

    test('separates two properties on one line by the comma between them', () => {
        assert.equal(
            foldMetadataBlocks('y = x #{ color: red, lineWidth: 3 }'),
            'y = x # color: red, lineWidth: 3',
        );
    });

    test('folds a block on a folder header inside its brace', () => {
        assert.equal(
            foldMetadataBlocks('folder "A" { #{\n    collapsed: true\n}\ny = x\n}'),
            'folder "A" { # collapsed: true\ny = x\n}',
        );
    });

    test('opens a blank styled row where it annotates nothing', () => {
        assert.equal(foldMetadataBlocks('#{\n    color: red\n}'), '# color: red');
    });

    test('keeps a `{…}` value whole, commas and all', () => {
        assert.equal(
            foldMetadataBlocks(
                'a = 1 #{\n    sliderBounds: {min: 0, max: 5}\n    playing: true\n}',
            ),
            'a = 1 # sliderBounds: {min: 0, max: 5}, playing: true',
        );
    });

    test('keeps what follows the block behind it', () => {
        assert.equal(
            foldMetadataBlocks('folder "A" {\ny = x #{ color: red }, y = 2x\n}'),
            'folder "A" {\ny = x # color: red, y = 2x\n}',
        );
    });

    test('leaves a script with no block of its own untouched', () => {
        const source = 'y = x # color: red\nz = 1';
        assert.equal(foldMetadataBlocks(source), source);
    });

    test('reads the properties of a block left unclosed', () => {
        assert.equal(foldMetadataBlocks('y = x #{\n    color: red'), 'y = x # color: red');
    });
});

describe('metadataBlockLines', () => {
    test('marks the properties and their closing brace, not the line they open on', () => {
        assert.deepEqual(metadataBlockLines(['y = x #{', '    color: red', '}', 'z = 1']), [
            false,
            true,
            true,
            false,
        ]);
    });
});

describe('insertMissingSeparators', () => {
    test('leaves two entries on two lines to their newline', () => {
        assert.deepEqual(insertMissingSeparators(['table {', 'x = [1]', 'y = [2]', '}']), [
            'table {',
            'x = [1]',
            'y = [2]',
            '}',
        ]);
    });

    test('adds the comma between two entries written on one line', () => {
        assert.deepEqual(insertMissingSeparators(['folder "A" { table { x = [1] } y = x }']), [
            'folder "A" { table { x = [1] }, y = x }',
        ]);
    });

    test('still separates the entries of an ordinary bracket', () => {
        // A newline inside a `[` continues the statement rather than ending
        // one, so there is nothing there to separate the entries.
        assert.deepEqual(insertMissingSeparators(['P = [', '(0, 0)', '(4, 0)', ']']), [
            'P = [',
            '(0, 0),',
            '(4, 0)',
            ']',
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
