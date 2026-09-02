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

    test('keeps a unary minus attached to what it negates', () => {
        // `-` is two operators wearing one character: what stands before it
        // decides which. Getting this wrong reads as a subtraction with nothing
        // on its left - `exp(- decay * x)`.
        assert.equal(format('y=-x'), 'y = -x');
        assert.equal(format('y=exp(-decay*abs(x))'), 'y = exp(-decay * abs(x))');
        assert.equal(format('P=[(-3,-3),(0,-1)]'), 'P = [(-3, -3), (0, -1)]');
        assert.equal(format('y={x<-pi: 0, x}'), 'y = {x < -pi: 0, x}');
    });

    test('keeps a subtraction spaced on both sides', () => {
        assert.equal(format('y=x^2-4x+3'), 'y = x ^ 2 - 4x + 3');
        assert.equal(format('y = a-b'), 'y = a - b');
        assert.equal(format('y = 2 - -3'), 'y = 2 - -3');
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

    test('leaves an import path alone', () => {
        assert.equal(format('import "./lib/a.axis" as "A"'), 'import "./lib/a.axis" as "A"');
    });

    test('indents an import inside a folder', () => {
        assert.equal(
            format('folder "F" {\nimport "./a.axis"\n}'),
            'folder "F" {\n    import "./a.axis"\n}',
        );
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
