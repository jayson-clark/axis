import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { format } from '@axis-dsl/syntax';
import { formatDocument, formatRange, formatSource } from '../dist/index.js';
import { examples } from './support.mts';

/** Apply a list of edits the service returned, back to front. */
function apply(source: string, edits: ReturnType<typeof formatDocument>): string {
    const lines = source.split('\n');
    const offset = (p: { line: number; character: number }) =>
        lines.slice(0, p.line).reduce((sum, line) => sum + line.length + 1, 0) + p.character;
    return [...edits]
        .sort((a, b) => offset(b.range.start) - offset(a.range.start))
        .reduce(
            (text, edit) =>
                text.slice(0, offset(edit.range.start)) +
                edit.newText +
                text.slice(offset(edit.range.end)),
            source,
        );
}

describe('formatting a document', () => {
    test('is the syntax package’s format', () => {
        const source = 'y=x^2@color:RED\nfolder "A"{a=1}\n';
        assert.equal(formatSource(source), format(source));
        assert.equal(apply(source, formatDocument(source)), format(source));
    });

    test('replaces the whole document in one edit', () => {
        const edits = formatDocument('a=1\nb=2');
        assert.equal(edits.length, 1);
        assert.deepEqual(edits[0].range, {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 3 },
        });
        assert.equal(edits[0].newText, 'a = 1\nb = 2');
    });

    test('has nothing to do for a formatted document', () => {
        assert.deepEqual(formatDocument('a = 1\n'), []);
    });

    test('leaves a document with a syntax error alone', () => {
        assert.deepEqual(formatDocument('a=1\nb = (\n'), []);
    });

    test('indents with the editor’s tab settings', () => {
        const source = 'folder "A" {\na=1\n}';
        assert.equal(formatSource(source, { tabSize: 2 }), 'folder "A" {\n  a = 1\n}');
        assert.equal(formatSource(source, { insertSpaces: false }), 'folder "A" {\n\ta = 1\n}');
    });

    test('wraps at the editor’s width', () => {
        const source = 'L = [1111, 2222, 3333, 4444]';
        assert.equal(formatSource(source, { maxLineLength: 20 }).split('\n').length > 1, true);
        assert.equal(formatSource(source, { maxLineLength: 0 }), source);
    });

    for (const { name, source } of examples) {
        test(`has nothing to do for ${name}`, () => {
            assert.deepEqual(formatDocument(source), []);
        });
    }
});

describe('formatting a range', () => {
    const range = (startLine: number, endLine: number, endCharacter = 1) => ({
        start: { line: startLine, character: 0 },
        end: { line: endLine, character: endCharacter },
    });

    test('formats only the statements the range touches', () => {
        const source = 'a=1\nb  =  2\nc=3';
        assert.equal(apply(source, formatRange(source, range(1, 1))), 'a=1\nb = 2\nc=3');
    });

    test('formats the whole of a statement the range only starts in', () => {
        const source = 'x=1\nfolder "A" {\na=1\nb=2\n}\nz=1';
        const formatted = apply(source, formatRange(source, range(1, 1)));
        assert.equal(formatted, 'x=1\nfolder "A" {\n    a = 1\n    b = 2\n}\nz=1');
    });

    test('formats a statement that shares a line with one the range touches', () => {
        const source = 'x=1\na=1;b=2\nz=1';
        assert.equal(apply(source, formatRange(source, range(1, 1))), 'x=1\na = 1; b = 2\nz=1');
    });

    test('keeps the comments among the statements it formats', () => {
        const source = 'a=1 // one\n// two\nb=2';
        assert.equal(
            apply(source, formatRange(source, range(0, 2))),
            'a = 1 // one\n// two\nb = 2',
        );
    });

    test('does not take in the line a selection ends at the start of', () => {
        const source = 'a=1\nb=2';
        assert.equal(apply(source, formatRange(source, range(0, 1, 0))), 'a = 1\nb=2');
    });

    test('formats a range even when another statement will not parse', () => {
        const source = 'a=1\nb = (';
        assert.equal(apply(source, formatRange(source, range(0, 0))), 'a = 1\nb = (');
    });

    test('has nothing to do where the range holds no statement', () => {
        assert.deepEqual(formatRange('// just a comment\n', range(0, 0)), []);
        assert.deepEqual(formatRange('a = 1\n', range(0, 0)), []);
    });

    test('keeps a Windows line ending', () => {
        const source = 'a=1\r\nb=2\r\n';
        assert.equal(apply(source, formatRange(source, range(0, 0))), 'a = 1\r\nb=2\r\n');
    });
});
