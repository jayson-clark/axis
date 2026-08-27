import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatAxisCode, formatAxisCodeWithIndent, indentLevelOf } from '../dist/index.js';

const OPTIONS = { tabSize: 4, insertSpaces: true };
const format = (source: string) => formatAxisCode(source, OPTIONS);

describe('formatAxisCode', () => {
    test('puts spaces around operators', () => {
        assert.equal(format('f(x)=x^2+1'), 'f(x) = x ^ 2 + 1');
    });

    test('leaves comparison operators intact', () => {
        assert.equal(format('y=x{x>=0}'), 'y = x{x >= 0}');
    });

    test('keeps the arrow operator in one piece', () => {
        assert.equal(format('y=x{x>0}->y+1'), 'y = x{x > 0} -> y + 1');
    });

    test('normalises metadata separators but not the values themselves', () => {
        // A value can be a hex colour or an expression, so only the `key:` and
        // the commas between entries are touched.
        assert.equal(format('y = x #color:red,lineWidth:2'), 'y = x # color: red, lineWidth: 2');
        assert.equal(format('p = (1,2) # onClick: a->a+1'), 'p = (1, 2) # onClick: a->a+1');
    });

    test('indents block bodies', () => {
        assert.equal(format('folder "A" {\ny=x\n}'), 'folder "A" {\n    y = x\n}');
    });

    test('de-indents on the closing brace', () => {
        assert.equal(format('table {\nx=[1],\ny=[2]\n}'), 'table {\n    x = [1],\n    y = [2]\n}');
    });

    test('leaves comments and notes untouched', () => {
        assert.equal(format('//  spaced   out'), '//  spaced   out');
        assert.equal(format('"A   note"'), '"A   note"');
    });

    test('preserves blank lines and trims trailing whitespace', () => {
        assert.equal(format('y = x   \n\nz = 1'), 'y = x\n\nz = 1');
    });

    test('inserts the commas a block was written without', () => {
        assert.equal(
            format('table {\nx = [1]\ny = [2]\n}'),
            'table {\n    x = [1],\n    y = [2]\n}',
        );
    });

    test('is idempotent', () => {
        const source = 'config {\n    showGrid: true\n}\n\nfolder "A" {\n    f(x) = x ^ 2\n}';
        assert.equal(format(source), format(format(source)));
    });

    test('leaves a hex colour in metadata alone', () => {
        assert.equal(format('y = x # color: #c74440'), 'y = x # color: #c74440');
    });
});

describe('formatAxisCodeWithIndent', () => {
    test('keeps a fragment at the depth it was lifted from', () => {
        assert.equal(formatAxisCodeWithIndent('y=x', OPTIONS, 2), '        y = x');
    });
});

describe('indentLevelOf', () => {
    test('counts spaces in tab-sized steps', () => {
        assert.equal(indentLevelOf('        y = x', OPTIONS), 2);
        assert.equal(indentLevelOf('y = x', OPTIONS), 0);
    });

    test('counts tabs when tabs are the indent', () => {
        assert.equal(indentLevelOf('\t\ty = x', { tabSize: 4, insertSpaces: false }), 2);
    });
});
