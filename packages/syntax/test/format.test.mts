import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, parse, printExpression, sameTree } from '../dist/index.js';
import { seeded, statementValue } from './trees.mts';

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, '../../../examples/graphs');
const fixtures = resolve(here, 'fixtures');

const axisFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return axisFiles(path);
        return entry.name.endsWith('.axis') ? [path] : [];
    });

/** The comments of a source, in order, as the lexer finds them. */
const comments = (source: string) =>
    parse(source)
        .tokens.filter(token => token.kind === 'comment')
        .map(token => token.text.trimEnd());

// Most of these are v1's formatter tests, translated to v2's syntax where the
// syntax changed (`@` for `#`, `;` between entries on a line) and dropped
// where the thing they pinned no longer exists.
describe('format: spacing', () => {
    test('puts spaces around operators', () => {
        assert.equal(format('f(x)=x^2+1'), 'f(x) = x ^ 2 + 1');
    });

    test('leaves comparison operators intact', () => {
        assert.equal(format('y=x{x>=0}'), 'y = x {x >= 0}');
    });

    test('keeps the arrow operator in one piece', () => {
        assert.equal(format('y=x{x>0}->y+1'), 'y = x {x > 0} -> y + 1');
    });

    test('spaces metadata, values included', () => {
        // v1 left a value as written, since it could not tell an expression
        // from text; the tree can.
        assert.equal(format('y = x @color:RED,lineWidth:2'), 'y = x @ color: RED, lineWidth: 2');
        assert.equal(format('p = (1,2) @ onClick: a->a+1'), 'p = (1, 2) @ onClick: a -> a + 1');
    });

    test('spaces a ticker’s action without gluing it to the keyword', () => {
        assert.equal(
            format('ticker a->a+1 @minStep:50,playing:true'),
            'ticker a -> a + 1 @ minStep: 50, playing: true',
        );
    });

    test('keeps a unary minus attached to what it negates', () => {
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

    test('writes implicit products so they read back the same', () => {
        assert.equal(format('y=2pi x+3cos(t)+2 (x+1)'), 'y = 2pi x + 3cos(t) + 2(x + 1)');
        assert.equal(format('y = (a)(b) + x   y'), 'y = (a)(b) + x y');
    });

    test('keeps the brackets an author wrote', () => {
        assert.equal(format('y = a*(x-b)^2+c'), 'y = a * (x - b) ^ 2 + c');
        assert.equal(format('y = ((x))'), 'y = ((x))');
    });

    test('spaces ranges the way the examples write them', () => {
        assert.equal(
            format('t = 0 @ slider:0..2pi step 0.02,playing'),
            't = 0 @ slider: 0..2pi step 0.02, playing',
        );
        assert.equal(format('p = 2 @ slider: 0..step 1'), 'p = 2 @ slider: 0.. step 1');
        assert.equal(format('k = 1 @ slider: 0..3 soft   max'), 'k = 1 @ slider: 0..3 soft max');
    });

    test("normalises Desmos' spelling of a list range to Axis'", () => {
        assert.equal(format('L = [1, ..., 10]'), 'L = [1...10]');
    });

    test('leaves comments and the text of notes untouched', () => {
        assert.equal(format('//  spaced   out'), '//  spaced   out');
        assert.equal(format('"A   note"'), '"A   note"');
        assert.equal(format('"a \\"quoted\\" note"'), '"a \\"quoted\\" note"');
    });

    test('leaves a hex colour in metadata alone', () => {
        assert.equal(format('y = x @ color: #c74440'), 'y = x @ color: #c74440');
    });

    test('leaves an import path alone', () => {
        assert.equal(format('import "./lib/a.axis" as "A"'), 'import "./lib/a.axis" as "A"');
    });

    test('leaves the URL an image names alone', () => {
        assert.equal(
            format('image "./images/wave.png" @ width:4'),
            'image "./images/wave.png" @ width: 4',
        );
        assert.equal(
            format('image "https://example.com/a.png"'),
            'image "https://example.com/a.png"',
        );
    });

    test('leaves enum values as they were spelt', () => {
        // Enums are case-insensitive (spec §4.2), so `dashed` is already
        // right; spelling it Desmos' way would be a change nobody asked for.
        assert.equal(format('y = x @ lineStyle: dashed'), 'y = x @ lineStyle: dashed');
    });
});

describe('format: blocks and lines', () => {
    test('indents block bodies', () => {
        assert.equal(format('folder "A" {\ny=x\n}'), 'folder "A" {\n    y = x\n}');
    });

    test('de-indents on the closing brace', () => {
        assert.equal(format('table {\nx=[1]\ny=[2]\n}'), 'table {\n    x = [1]\n    y = [2]\n}');
    });

    test('indents an import inside a folder', () => {
        assert.equal(
            format('folder "F" {\nimport "./a.axis"\n}'),
            'folder "F" {\n    import "./a.axis"\n}',
        );
    });

    test('keeps a block written on one line on one line', () => {
        assert.equal(format('table { x = [1,2];y = [3,4] }'), 'table { x = [1, 2]; y = [3, 4] }');
        assert.equal(
            format('folder "F" { table { x = [1] }; y = x }'),
            'folder "F" { table { x = [1] }; y = x }',
        );
        assert.equal(
            format('config {showGrid:true;xmin:-7}'),
            'config { showGrid: true; xmin: -7 }',
        );
        assert.equal(format('folder { @ hidden; y = x }'), 'folder { @ hidden; y = x }');
        assert.equal(format('folder "Empty" {\n}'), 'folder "Empty" {}');
    });

    test('keeps a block written over lines over lines', () => {
        assert.equal(format('config {\nshowGrid: true\n}'), 'config {\n    showGrid: true\n}');
    });

    test('puts a folder’s metadata on the line of its brace', () => {
        assert.equal(
            format('folder "W" { @{ collapsed; hidden }\na = 1\n}'),
            'folder "W" { @ collapsed, hidden\n    a = 1\n}',
        );
    });

    test('keeps statements separated by ; on one line', () => {
        assert.equal(format('a=1;b=2'), 'a = 1; b = 2');
        assert.equal(format('a=1;;b=2;'), 'a = 1; b = 2');
    });

    test('settles a block’s entries on one to a line', () => {
        assert.equal(
            format('table {\nx = [1];\ny = [2]\n}'),
            'table {\n    x = [1]\n    y = [2]\n}',
        );
        assert.equal(format('config {\n  a: 1\n  b: 2;\n}'), 'config {\n    a: 1\n    b: 2\n}');
    });

    test('preserves blank lines, a run of them as one, and trims trailing whitespace', () => {
        assert.equal(format('y = x   \n\nz = 1'), 'y = x\n\nz = 1');
        assert.equal(format('y = x\n\n\n\nz = 1\n'), 'y = x\n\nz = 1\n');
        assert.equal(format('\n\ny = x'), 'y = x');
        assert.equal(format('folder {\n\n  y = x\n\n}'), 'folder {\n    y = x\n}');
    });

    test('keeps the file’s last newline, and only one', () => {
        assert.equal(format('y = x\n'), 'y = x\n');
        assert.equal(format('y = x\n\n\n'), 'y = x\n');
        assert.equal(format('y = x'), 'y = x');
        assert.equal(format(''), '');
    });

    test('keeps Windows line endings', () => {
        assert.equal(format('a=1 // one\r\n\r\nb=2\r\n'), 'a = 1 // one\r\n\r\nb = 2\r\n');
    });

    test('indents with what it is given', () => {
        assert.equal(format('folder {\ny = x\n}', { indent: '\t' }), 'folder {\n\ty = x\n}');
        assert.equal(format('folder {\ny = x\n}', { indent: 2 }), 'folder {\n  y = x\n}');
    });

    test('is idempotent', () => {
        const source = 'config {\n    showGrid: true\n}\n\nfolder "A" {\n    f(x) = x ^ 2\n}';
        assert.equal(format(source), format(format(source)));
    });

    test('leaves a file that does not parse exactly as it was', () => {
        for (const broken of [
            'y = = 2',
            'y=x\nfolder "A" {',
            'a=1\n$$$\nb=2',
            'config { a: 1, b: 2 }',
        ]) {
            assert.equal(format(broken), broken);
        }
    });
});

describe('format: comments', () => {
    test('a comment on a line of its own stays there, at the depth of the code', () => {
        assert.equal(format('   // alone\ny=x'), '// alone\ny = x');
        assert.equal(
            format('folder {\n// in\ny=x\n     // last\n}'),
            'folder {\n    // in\n    y = x\n    // last\n}',
        );
    });

    test('a comment after a statement stays after it', () => {
        assert.equal(format('a=1   // one\nb=2;c=3 // two'), 'a = 1 // one\nb = 2; c = 3 // two');
        assert.equal(format('config { a: 1 } // c'), 'config { a: 1 } // c');
    });

    test('a comment on the line a block opens stays on it', () => {
        assert.equal(
            format('folder "F" { // header\ny=x\n}'),
            'folder "F" { // header\n    y = x\n}',
        );
        assert.equal(
            format('folder { @ hidden // after\ny=x\n}'),
            'folder { @ hidden // after\n    y = x\n}',
        );
    });

    test('comments in a metadata block stay with their properties', () => {
        assert.equal(
            format('y=x @{ // header\ncolor:RED // red\n// alone\n\nhidden\n}'),
            'y = x @{ // header\n    color: RED // red\n    // alone\n\n    hidden\n}',
        );
    });

    test('a statement with a comment inside its brackets is kept as written, re-indented', () => {
        assert.equal(
            format('folder {\n  P = [ // inside\n    1,\n      2  \n  ]\n}'),
            'folder {\n    P = [ // inside\n      1,\n        2\n    ]\n}',
        );
    });

    test('nothing is lost: a file of comments and blank lines', () => {
        const source = '// a\n\n\n// b\n   // c\n';
        assert.equal(format(source), '// a\n\n// b\n// c\n');
    });
});

describe('format: wrapping a long line', () => {
    // A width small enough that the cases stay readable; the default is 100.
    const wrap = (source: string) => format(source, { maxLineLength: 40 });

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
            wrap('folder "Curves" { y = sin(x); y = cos(x); y = tan(x) }'),
            'folder "Curves" {\n    y = sin(x)\n    y = cos(x)\n    y = tan(x)\n}',
        );
    });

    test('keeps breaking an entry that is still too long', () => {
        assert.equal(
            wrap('folder "F" {\nQ = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)]\n}'),
            'folder "F" {\n    Q = [\n        (0, 0),\n        (4, 0),\n        (8, 3),' +
                '\n        (12, 1),\n        (16, 7)\n    ]\n}',
        );
    });

    test('moves a property run too long for the line into a block', () => {
        assert.equal(
            wrap('y = x @ color: #c74440, lineWidth: 3, lineStyle: DASHED'),
            'y = x @{\n    color: #c74440\n    lineWidth: 3\n    lineStyle: DASHED\n}',
        );
    });

    test('breaks the statement as well when it is long in its own right', () => {
        assert.equal(
            wrap('Q = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)] @ color: RED, lineWidth: 3'),
            'Q = [\n    (0, 0),\n    (4, 0),\n    (8, 3),\n    (12, 1),\n    (16, 7)\n] @{' +
                '\n    color: RED\n    lineWidth: 3\n}',
        );
    });

    test('leaves a single property on the line it annotates', () => {
        const long = 'y = x @ label: "a label that runs on past the column this wraps at"';
        assert.equal(wrap(long), long);
    });

    test('breaks the bracket that runs past the width, not an earlier one', () => {
        assert.equal(
            wrap('y = polygon((0, 0), (1, 1)) + polygon((5, 5), (6, 6), (7, 7))'),
            'y = polygon((0, 0), (1, 1)) + polygon(\n    (5, 5),\n    (6, 6),\n    (7, 7)\n)',
        );
    });

    test('breaks through a bracket with one thing in it', () => {
        assert.equal(
            wrap('y = sqrt(polygon((0, 0), (10, 0), (10, 10)))'),
            'y = sqrt(polygon(\n    (0, 0),\n    (10, 0),\n    (10, 10)\n))',
        );
    });

    test('leaves a line long when nothing on it can be broken', () => {
        const note = '"A note that runs on well past the column this wraps at"';
        assert.equal(wrap(note), note);

        const comment = '// a comment that runs on well past the column this wraps at';
        assert.equal(wrap(comment), comment);
    });

    test('leaves a small bracket alone on a line made long by a label', () => {
        const point = '(-3, -3) @ label: "the label is what makes this line long"';
        assert.equal(wrap(point), point);
    });

    test('leaves every line alone at maxLineLength 0', () => {
        const source = 'P = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)] @ color: RED, lineWidth: 3';
        assert.equal(format(source, { maxLineLength: 0 }), source);
    });

    test('wraps at 100 columns when the caller does not say', () => {
        const entries = Array.from({ length: 30 }, (_, i) => `(${i}, ${i})`).join(', ');
        const wrapped = format(`P = [${entries}]`);

        assert.ok(
            wrapped.split('\n').every(line => line.length <= 100),
            'a line came out longer than the default width',
        );
    });

    test('keeps a bracket its author spread over lines spread', () => {
        const spread = 'wave(x) = {\n    x < -pi: 0,\n    x > pi: 0\n} @ color: RED';
        assert.equal(format(spread), spread);
        assert.equal(format('L = [\n1, 2]'), 'L = [\n    1,\n    2\n]');
    });

    test('a wrapped line is source the formatter leaves alone', () => {
        const source = 'P = [(0, 0), (4, 0), (8, 3), (12, 1), (16, 7)] @ color: RED';
        const wrapped = wrap(source);

        assert.equal(wrap(wrapped), wrapped);
    });
});

// The examples are the widest use of the language there is, and the fixtures
// the widest use of its syntax: every one of them, at the default width and at
// a narrow one that makes the wrapping work, has to come back as the same
// source, with the same comments in the same order, and settle.
describe('format: every example and fixture', () => {
    const files = [...axisFiles(examples), ...axisFiles(fixtures)];

    for (const path of files) {
        const name = path.slice(resolve(here, '../../..').length + 1);
        const source = readFileSync(path, 'utf8');

        for (const maxLineLength of [100, 40]) {
            test(`${name} at ${maxLineLength} columns`, () => {
                const formatted = format(source, { maxLineLength });
                const reparsed = parse(formatted);

                assert.deepEqual(reparsed.diagnostics, []);
                assert.ok(sameTree(reparsed.file, parse(source).file), 'the tree changed');
                assert.deepEqual(comments(formatted), comments(source));
                assert.equal(format(formatted, { maxLineLength }), formatted, 'not idempotent');
            });
        }
    }

    test('the examples are already formatted', () => {
        const unformatted = axisFiles(examples).filter(path => {
            const source = readFileSync(path, 'utf8');
            return format(source) !== source;
        });
        assert.deepEqual(
            unformatted.map(path => path.slice(examples.length + 1)),
            [],
        );
    });
});

// Random trees make the layout meet brackets inside brackets inside bars that
// no example has: printed, then squeezed into a narrow width, each has to come
// back as itself and settle.
describe('format: random statements at narrow widths', () => {
    const SEEDS = 1500;
    test(`${SEEDS} seeds`, () => {
        for (let seed = 1; seed <= SEEDS; seed++) {
            const random = seeded(seed);
            const source = `folder {\n${printExpression(statementValue(random))} @ color: RED, hidden\n}\n`;
            const maxLineLength = 20 + Math.floor(random() * 40);
            const formatted = format(source, { maxLineLength });
            const reparsed = parse(formatted);

            const where = `seed ${seed} at ${maxLineLength}:\n${source}\n${formatted}`;
            assert.deepEqual(reparsed.diagnostics, [], where);
            assert.ok(sameTree(reparsed.file, parse(source).file), where);
            assert.equal(format(formatted, { maxLineLength }), formatted, where);
        }
    });
});
