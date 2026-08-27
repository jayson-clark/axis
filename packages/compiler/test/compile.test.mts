import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileAxis } from '../dist/index.js';
import type { Expression, Folder, Note, Table } from '@axis-dsl/desmos';

const compile = (source: string) => compileAxis(source).expressions;
const only = <T,>(source: string) => compile(source)[0] as T;

describe('expressions', () => {
    test('compiles one statement into one expression', () => {
        const expression = only<Expression>('y = x^2');
        assert.equal(expression.type, 'expression');
        assert.equal(expression.latex, 'y=x^2');
    });

    test('skips blank lines and comments', () => {
        const expressions = compile('// a comment\n\ny = x\n');
        assert.equal(expressions.length, 1);
        assert.equal((expressions[0] as Expression).latex, 'y=x');
    });

    test('gives every expression a distinct id', () => {
        const ids = compile('y = x\nz = 1\nw = 2').map(e => e.id);
        assert.equal(new Set(ids).size, 3);
    });
});

describe('notes', () => {
    test('compiles a bare string into a note', () => {
        const note = only<Note>('"Getting started"');
        assert.equal(note.type, 'text');
        assert.equal(note.text, 'Getting started');
    });
});

describe('folders', () => {
    test('compiles a folder and puts its contents inside it', () => {
        const [folder, child] = compile('folder "Curves" {\ny = x\n}') as [Folder, Expression];
        assert.equal(folder.type, 'folder');
        assert.equal(folder.title, 'Curves');
        assert.equal(child.folderId, folder.id);
    });

    test('closes the folder at its brace', () => {
        const [, , after] = compile('folder "A" {\ny = x\n}\nz = 1') as Expression[];
        assert.equal(after.folderId, undefined);
    });

    test('reads collapsed off the header metadata', () => {
        const folder = only<Folder>('folder "A" { # collapsed: true\n}');
        assert.equal(folder.collapsed, true);
    });
});

describe('tables', () => {
    test('compiles a table written inline', () => {
        const table = only<Table>('table { x = [1, 2], y = [1, 4] }');
        assert.equal(table.type, 'table');
        assert.deepEqual(
            table.columns.map(column => [column.latex, column.values]),
            [
                ['x', ['1', '2']],
                ['y', ['1', '4']],
            ],
        );
    });

    test('compiles the same table written out', () => {
        const inline = only<Table>('table { x = [1, 2], y = [1, 4] }');
        const expanded = only<Table>('table {\n    x = [1, 2],\n    y = [1, 4]\n}');
        assert.deepEqual(expanded, inline);
    });
});

describe('config', () => {
    test('collects the config block into settings', () => {
        const { settings } = compileAxis('config {\n    showGrid: true,\n    fontSize: 16\n}');
        assert.deepEqual(settings, { showGrid: true, fontSize: 16 });
    });

    test('leaves settings undefined when there is no config block', () => {
        assert.equal(compileAxis('y = x').settings, undefined);
    });

    test('does not emit an expression for the config block', () => {
        assert.deepEqual(compile('config { showGrid: true }'), []);
    });
});

describe('metadata', () => {
    test('applies styling properties', () => {
        const expression = only<Expression>('y = x # color: #c74440, lineStyle: DASHED');
        assert.equal(expression.color, '#c74440');
        assert.equal(expression.lineStyle, 'DASHED');
    });

    test('keeps the always-string properties as strings', () => {
        const expression = only<Expression>('y = x # lineWidth: 2');
        assert.equal(expression.lineWidth, '2');
    });

    test('reads the bare flags', () => {
        assert.equal(only<Expression>('y = x # hidden').hidden, true);
        assert.equal(only<Expression>('y = x # secret').secret, true);
    });

    test('turns onClick into clickableInfo', () => {
        const expression = only<Expression>('p = (1,2) # onClick: a -> a + 1');
        assert.deepEqual(expression.clickableInfo, { enabled: true, latex: 'a\\to a+1' });
    });

    test('honours clickable: false', () => {
        const expression = only<Expression>('p = (1,2) # onClick: a -> a + 1, clickable: false');
        assert.equal(expression.clickableInfo?.enabled, false);
    });

    test('parses sliderBounds into the object Desmos expects', () => {
        const expression = only<Expression>('a = 1 # sliderBounds: {min: 0, max: 10, step: 0.1}');
        assert.deepEqual(expression.sliderBounds, { min: 0, max: 10, step: 0.1 });
    });
});

describe('layout', () => {
    test('a script written inline compiles the same as one written out', () => {
        const inline = compileAxis('folder "A" { y = x, z = 1 }');
        const expanded = compileAxis('folder "A" {\n    y = x,\n    z = 1\n}');
        assert.deepEqual(inline, expanded);
    });

    test('joins a statement split across an open bracket', () => {
        const expression = only<Expression>('P = [\n    (0,0),\n    (4,0)\n]');
        // Desmos takes list brackets bare; only parens and braces are sized.
        assert.equal(expression.latex, 'P=[\\left(0,0\\right),\\left(4,0\\right)]');
    });
});
