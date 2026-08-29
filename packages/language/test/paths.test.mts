import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { axisPathCompletions, axisPathContext } from '../dist/index.js';
import type { AxisDirectoryEntry } from '../dist/index.js';

/** The context at the end of `source`, which is where a path is being typed. */
const contextAtEnd = (source: string) => {
    const lines = source.split('\n');
    return axisPathContext(source, {
        line: lines.length - 1,
        character: lines[lines.length - 1].length,
    });
};

const ENTRIES: AxisDirectoryEntry[] = [
    { name: 'lib', directory: true },
    { name: 'images', directory: true },
    { name: '.git', directory: true },
    { name: 'curves.axis', directory: false },
    { name: 'beach.png', directory: false },
    { name: 'notes.txt', directory: false },
];

const labels = (source: string) => {
    const context = contextAtEnd(source)!;
    return axisPathCompletions(context, ENTRIES).map(item => item.label);
};

describe('paths being typed', () => {
    test('knows an import is naming one', () => {
        const context = contextAtEnd('import "./li')!;

        assert.equal(context.kind, 'import');
        assert.equal(context.prefix, './li');
        assert.equal(context.directory, './');
        // The segment being typed, which a completion replaces: `li`.
        assert.deepEqual([context.line, context.startCharacter, context.endCharacter], [0, 10, 12]);
    });

    test('knows an image is naming one, and which directory it is in', () => {
        const context = contextAtEnd('image "./images/wa')!;

        assert.equal(context.kind, 'image');
        assert.equal(context.directory, './images/');
        assert.equal(context.startCharacter, 16);
    });

    test('reads an empty path as the directory the file is in', () => {
        const context = contextAtEnd('import "')!;

        assert.equal(context.prefix, '');
        assert.equal(context.directory, '');
        assert.equal(context.startCharacter, 8);
    });

    test('finds one inside a folder written on a line', () => {
        assert.equal(contextAtEnd('folder "F" { image "./a')?.kind, 'image');
    });

    test('leaves the title of an import alone, which names no file', () => {
        assert.equal(contextAtEnd('import "./a.axis" as "Cu'), undefined);
    });

    test('says nothing where no path is being typed', () => {
        assert.equal(contextAtEnd('y = x'), undefined);
        assert.equal(contextAtEnd('"a note about ./lib'), undefined);
        assert.equal(contextAtEnd('// import "./a'), undefined);
        assert.equal(contextAtEnd('import "./a.axis"'), undefined);
    });
});

describe('what a path offers', () => {
    test('offers the directories first, with their separator', () => {
        assert.deepEqual(labels('import "').slice(0, 2), ['images/', 'lib/']);
    });

    test('offers an import the scripts, and an image the pictures', () => {
        assert.deepEqual(labels('import "'), ['images/', 'lib/', 'curves.axis']);
        assert.deepEqual(labels('image "'), ['images/', 'lib/', 'beach.png']);
    });

    test('says what each one is', () => {
        const context = contextAtEnd('image "')!;
        const details = Object.fromEntries(
            axisPathCompletions(context, ENTRIES).map(item => [item.label, item.detail]),
        );

        assert.equal(details['lib/'], 'Folder');
        assert.equal(details['beach.png'], 'image/png');
    });

    test('leaves out what a script cannot name', () => {
        // The dotfile and the .txt: one is not a path anybody writes, and the
        // other would compile to an error.
        assert.ok(!labels('import "').includes('.git/'));
        assert.ok(!labels('image "').includes('notes.txt'));
    });
});
