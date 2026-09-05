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

    test('spaces a ticker\u2019s action without gluing it to the keyword', () => {
        // `ticker a` is a keyword and a name, not two names multiplied - so the
        // expression rules apply to the action and stop short of the keyword.
        assert.equal(
            format('ticker a->a+1 #minStep:50,playing:true'),
            'ticker a -> a + 1 # minStep: 50, playing: true',
        );
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

describe('wrapping a long line', () => {
    // A width small enough that the cases stay readable; the default is 100.
    const NARROW = { tabSize: 4, insertSpaces: true, maxLineLength: 40 };
    const wrap = (source: string) => formatAxisCode(source, NARROW);

    test('breaks a list one entry to a line', () => {
        assert.equal(
            wrap('P = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)]'),
            'P = [\n    (0, 0),\n    (4, 0),\n    (8, 3),\n    (12, 1),\n    (16, 7)\n]',
        );
    });

    test('breaks a call at its arguments', () => {
        assert.equal(
            wrap('y = polygon((0, 0), (10, 0), (10, 10), (0, 10))'),
            'y = polygon(\n    (0, 0),\n    (10, 0),\n    (10, 10),\n    (0, 10)\n)',
        );
    });

    test('breaks a piecewise at its branches', () => {
        assert.equal(
            wrap('y = {x < 0: -x, 0 <= x <= 4: x ^ 2, x > 4: 16}'),
            'y = {\n    x < 0: -x,\n    0 <= x <= 4: x ^ 2,\n    x > 4: 16\n}',
        );
    });

    test('breaks a block written on one line', () => {
        assert.equal(
            wrap('folder "Curves" { y = sin(x), y = cos(x), y = tan(x) }'),
            'folder "Curves" {\n    y = sin(x),\n    y = cos(x),\n    y = tan(x)\n}',
        );
    });

    test('keeps breaking an entry that is still too long', () => {
        assert.equal(
            wrap('folder "F" {\nQ = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)]\n}'),
            'folder "F" {\n    Q = [\n        (0, 0),\n        (4, 0),\n        (8, 3),' +
                '\n        (12, 1),\n        (16, 7)\n    ]\n}',
        );
    });

    test('keeps trailing metadata whole on the closing line', () => {
        // The compiler only reads metadata that reaches it on one line, so a
        // wrapped property list would quietly become an expression of its own.
        assert.equal(
            wrap('Q = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)] # color: red, lineWidth: 3'),
            'Q = [\n    (0, 0),\n    (4, 0),\n    (8, 3),\n    (12, 1),\n    (16, 7)\n]' +
                ' # color: red, lineWidth: 3',
        );
    });

    test('breaks the bracket that runs past the width, not an earlier one', () => {
        assert.equal(
            wrap('y = polygon((0, 0), (1, 1)) + polygon((5, 5), (6, 6), (7, 7))'),
            'y = polygon((0, 0), (1, 1)) + polygon(\n    (5, 5),\n    (6, 6),\n    (7, 7)\n)',
        );
    });

    test('leaves a line long when nothing on it can be broken', () => {
        // A note, a comment and a property run all stay on their line whatever
        // the width: breaking the brackets around them would not shorten it.
        const note = '"A note that runs on well past the column this wraps at"';
        assert.equal(wrap(note), note);

        const comment = '// a comment that runs on well past the column this wraps at';
        assert.equal(wrap(comment), comment);

        const metadata = 'y = x # color: #c74440, lineWidth: 3, lineStyle: DASHED';
        assert.equal(wrap(metadata), metadata);
    });

    test('leaves a small bracket alone on a line made long by a label', () => {
        const point = '(-3, -3) # label: "the label is what makes this line long"';
        assert.equal(wrap(point), point);
    });

    test('leaves every line alone at maxLineLength 0', () => {
        const source = 'P = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)]';
        assert.equal(formatAxisCode(source, { ...NARROW, maxLineLength: 0 }), source);
    });

    test('wraps at 100 columns when the caller does not say', () => {
        const entries = Array.from({ length: 30 }, (_, i) => `(${i}, ${i})`).join(', ');
        const wrapped = format(`P = [${entries}]`);

        assert.ok(
            wrapped.split('\n').every(line => line.length <= 100),
            'a line came out longer than the default width',
        );
    });

    test('a wrapped line is a script the formatter leaves alone', () => {
        const source = 'P = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)] # color: red';
        const wrapped = wrap(source);

        assert.equal(wrap(wrapped), wrapped);
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
