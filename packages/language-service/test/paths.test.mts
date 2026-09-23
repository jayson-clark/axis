import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getCompletions, getPathCompletions, getPathContext } from '../dist/index.js';
import type { DirectoryEntry } from '../dist/index.js';
import { textOf } from './support.mts';

/** The context at the end of `source`, which is where a path is being typed. */
const endOf = (source: string) => {
    const lines = source.split('\n');
    return { line: lines.length - 1, character: lines[lines.length - 1].length };
};
const contextAtEnd = (source: string) => getPathContext(source, endOf(source));

const ENTRIES: DirectoryEntry[] = [
    { name: 'lib', directory: true },
    { name: 'images', directory: true },
    { name: '.git', directory: true },
    { name: 'curves.axis', directory: false },
    { name: 'beach.png', directory: false },
    { name: 'notes.txt', directory: false },
];

const labels = (source: string) =>
    getPathCompletions(contextAtEnd(source)!, ENTRIES).map(item => item.label);

describe('paths being typed', () => {
    test('knows an import is naming one', () => {
        const source = 'import "./li';
        const context = contextAtEnd(source)!;

        assert.equal(context.kind, 'import');
        assert.equal(context.prefix, './li');
        assert.equal(context.directory, './');
        // The segment being typed, which a completion replaces: `li`.
        assert.equal(textOf(source, context.range), 'li');
        assert.deepEqual(context.range.start, { line: 0, character: 10 });
    });

    test('knows an image is naming one, and which directory it is in', () => {
        const context = contextAtEnd('image "./images/wa')!;

        assert.equal(context.kind, 'image');
        assert.equal(context.directory, './images/');
        assert.equal(context.range.start.character, 16);
    });

    test('reads an empty path as the directory the file is in', () => {
        const context = contextAtEnd('import "')!;

        assert.equal(context.prefix, '');
        assert.equal(context.directory, '');
        assert.equal(context.range.start.character, 8);
    });

    test('finds one inside a closed string, the cursor before the quote an editor wrote', () => {
        const source = 'import "./lib/"';
        const context = getPathContext(source, { line: 0, character: 14 })!;
        assert.equal(context.directory, './lib/');
    });

    test('finds one inside a folder written on a line', () => {
        assert.equal(contextAtEnd('folder "F" { image "./a')?.kind, 'image');
    });

    test('finds one on a later line of a file', () => {
        assert.equal(contextAtEnd('y = x\nfolder "F" {\n    import "./lib/')?.directory, './lib/');
    });

    test('leaves the title of an import alone, which names no file', () => {
        assert.equal(contextAtEnd('import "./a.axis" as "Cu'), undefined);
    });

    test('says nothing where no path is being typed', () => {
        assert.equal(contextAtEnd('y = x'), undefined);
        assert.equal(contextAtEnd('"a note about ./lib'), undefined);
        assert.equal(contextAtEnd('// import "./a'), undefined);
        assert.equal(contextAtEnd('import "./a.axis"'), undefined);
        assert.equal(contextAtEnd('y = x @ label: "./a'), undefined);
    });
});

describe('what a path offers', () => {
    test('offers the directories first, with their separator', () => {
        assert.deepEqual(labels('import "').slice(0, 2), ['images/', 'lib/']);
    });

    test('offers an import the Axis files, and an image the pictures', () => {
        assert.deepEqual(labels('import "'), ['images/', 'lib/', 'curves.axis']);
        assert.deepEqual(labels('image "'), ['images/', 'lib/', 'beach.png']);
    });

    test('says what each one is', () => {
        const items = getPathCompletions(contextAtEnd('image "')!, ENTRIES);
        const details = Object.fromEntries(items.map(item => [item.label, item.detail]));

        assert.equal(details['lib/'], 'Folder');
        assert.equal(details['beach.png'], 'image/png');
        // A directory asks for the next segment once it is chosen.
        assert.equal(items.find(item => item.label === 'lib/')!.retrigger, true);
    });

    test('leaves out what a file cannot name', () => {
        // The dotfile and the .txt: one is not a path anybody writes, and the
        // other would compile to an error.
        assert.ok(!labels('import "').includes('.git/'));
        assert.ok(!labels('image "').includes('notes.txt'));
    });
});

describe('paths through getCompletions', () => {
    test('asks the host to list the directory being typed in', () => {
        const source = 'import "./lib/cu';
        const asked: string[] = [];
        const items = getCompletions(source, endOf(source), {
            listDirectory: (directory, kind) => {
                asked.push(`${kind} ${directory}`);
                return ENTRIES;
            },
        });
        assert.deepEqual(asked, ['import ./lib/']);
        assert.deepEqual(
            items.map(item => item.label),
            ['images/', 'lib/', 'curves.axis'],
        );
        assert.equal(textOf(source, items[0].range!), 'cu');
    });

    test('offers nothing in a path when the host cannot list', () => {
        assert.deepEqual(getCompletions('import "./', { line: 0, character: 10 }), []);
    });
});
