import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type ExpressionStatement } from '../dist/index.js';
import { tree } from './support.mts';

describe('separation (spec §3.1)', () => {
    test('a newline or a ; ends a statement', () => {
        assert.equal(tree('a = 1; b = 2\nc = 3'), '(= a 1)\n(= b 2)\n(= c 3)');
    });

    test('blank statements are ignored', () => {
        assert.equal(tree(';;\n\n a = 1 ;; \n\n;'), '(= a 1)');
        assert.equal(tree(''), '');
        assert.equal(tree('// only a comment\n'), '');
    });

    test('a comment trails a statement without ending it early', () => {
        assert.equal(tree('a = 1 // one\nb = 2'), '(= a 1)\n(= b 2)');
    });

    test('a statement may spread over lines inside brackets', () => {
        assert.equal(tree('L = [\n  1,\n  2,\n]\nb = 2').split('\n')[1], '(= b 2)');
        assert.equal(
            tree('y = {\n  x < 0: -x,\n  x\n}'),
            '(= y (piecewise (if (< x 0) (- x)) (else x)))',
        );
    });
});

describe('statement forms (spec §3.2)', () => {
    test('config', () => {
        assert.equal(
            tree('config { showGrid: true; xmin: -7; xmax: 7 }'),
            '(config showGrid:true xmin:(- 7) xmax:7)',
        );
        assert.equal(
            tree('config {\n  showGrid: false\n  degreeMode\n}'),
            '(config showGrid:false degreeMode)',
        );
        assert.equal(tree('config {}'), '(config)');
    });

    test('folder, titled', () => {
        assert.equal(
            tree('folder "Waves" {\n  y = x\n  y = 2x\n}'),
            '(folder "Waves" (= y x) (= y (implicit 2 x)))',
        );
    });

    test('folder, untitled', () => {
        assert.equal(tree('folder { y = x }'), '(folder _ (= y x))');
        assert.equal(tree('folder {}'), '(folder _)');
    });

    test('folder metadata straight after the {', () => {
        assert.equal(
            tree('folder "W" { @ collapsed\n  a = 1\n}'),
            '(folder "W" (@ collapsed) (= a 1))',
        );
        assert.equal(
            tree('folder { @ collapsed, hidden; a = 1 }'),
            '(folder _ (@ collapsed hidden) (= a 1))',
        );
        assert.equal(
            tree('folder "W" { @{ collapsed; secret }\n  a = 1\n}'),
            '(folder "W" (@{} collapsed secret) (= a 1))',
        );
    });

    test('a statement on the line after the { is the first statement, not metadata', () => {
        assert.equal(
            tree('folder "W" {\n  a = 1 @ hidden\n}'),
            '(folder "W" (statement (= a 1) (@ hidden)))',
        );
    });

    test('folders nest in the tree, for the checker to refuse', () => {
        assert.equal(tree('folder { folder { y = x } }'), '(folder _ (folder _ (= y x)))');
    });

    test('table: header columns, computed columns, and metadata', () => {
        assert.equal(
            tree('table { x = [1, 2, 3]; y = [1, 4, 9] @ lines }'),
            '(table (column x [1 2 3]) (column y [1 4 9] (@ lines)))',
        );
        assert.equal(
            tree('table {\n  x = [1, 2]\n  x ^ 2\n}'),
            '(table (column x [1 2]) (column (^ x 2)))',
        );
        assert.equal(tree('table { x = [] }'), '(table (column x []))');
    });

    test('table metadata straight after the {', () => {
        assert.equal(
            tree('table { @ color: RED; x = [1, 2, 3]; x ^ 2 }'),
            '(table (@ color:RED) (column x [1 2 3]) (column (^ x 2)))',
        );
    });

    test('a column that is not header = list is computed, whole', () => {
        assert.equal(tree('table { x = 5 }'), '(table (column (= x 5)))');
    });

    test('style', () => {
        assert.equal(
            tree('style emphasis { color: RED; lineWidth: 4 }'),
            '(style emphasis color:RED lineWidth:4)',
        );
        assert.equal(
            tree('style loud {\n  use: swatch\n  color: RED\n  showLabel\n}'),
            '(style loud use:swatch color:RED showLabel)',
        );
    });

    test('macro, with parameters, without, and with none', () => {
        assert.equal(
            tree('macro wave(k, phase) = sin(k * x + phase)'),
            '(macro wave (k phase) (call sin (+ (* k x) phase)))',
        );
        assert.equal(tree('macro TAU2 = 2tau'), '(macro TAU2 (implicit 2 tau))');
        assert.equal(tree('macro f() = 1'), '(macro f () 1)');
    });

    test('macro parameters: null for none, [] for ()', () => {
        const [bare, empty] = parse('macro A = 1\nmacro B() = 1').file.statements;
        assert.equal(bare.kind === 'MacroStatement' && bare.parameters, null);
        assert.deepEqual(empty.kind === 'MacroStatement' && empty.parameters, []);
    });

    test('import', () => {
        assert.equal(tree('import "./lib/waves"'), '(import "./lib/waves")');
        assert.equal(
            tree('import "./lib/waves.axis" as "Waves"'),
            '(import "./lib/waves.axis" as "Waves")',
        );
        assert.equal(
            tree('import "./lib/waves" @ collapsed: false'),
            '(import "./lib/waves" (@ collapsed:false))',
        );
    });

    test('image', () => {
        assert.equal(
            tree('image "./beach.png" @ center: (0, 1), width: 10'),
            '(image "./beach.png" (@ center:(tuple 0 1) width:10))',
        );
    });

    test('ticker', () => {
        assert.equal(
            tree('ticker n -> n + dt @ minStep: 50, playing'),
            '(ticker (-> n (+ n dt)) (@ minStep:50 playing))',
        );
        assert.equal(tree('ticker a -> 1, b -> 2'), '(ticker (run (-> a 1) (-> b 2)))');
        assert.equal(tree('ticker R'), '(ticker R)');
    });

    test('note', () => {
        assert.equal(tree('"A note"'), '(note "A note")');
        assert.equal(tree('"A note" @ secret'), '(note "A note" (@ secret))');
        assert.equal(tree('"say \\"hi\\""'), '(note "say \\"hi\\"")');
    });

    test('a string with more after it is an expression, not a note', () => {
        assert.equal(tree('"a" = b'), '(= "a" b)');
    });

    test('the example from spec §1', () => {
        const source = [
            '// A comment runs to the end of the line.',
            'config { showGrid: true; xmin: -7; xmax: 7 }',
            '',
            'style emphasis { color: RED; lineWidth: 4 }',
            'macro wave(k, phase) = sin(k * x + phase)',
            '',
            '"A note"',
            '',
            'folder "Waves" { @ collapsed',
            '    a = 1 @ slider: -5..5 step 0.5',
            '    y = a * wave(2, tau / 4) @ use: emphasis',
            '    y = wave(1, 0) @{',
            '        color: rgb(40, 120, 200)',
            '        lineStyle: DASHED',
            '    }',
            '}',
            '',
            'table { x = [1, 2, 3]; y = [1, 4, 9] @ lines }',
            '',
            'n = 0',
            'ticker n -> n + dt @ minStep: 50, playing',
        ].join('\n');
        assert.equal(
            tree(source),
            [
                '(config showGrid:true xmin:(- 7) xmax:7)',
                '(style emphasis color:RED lineWidth:4)',
                '(macro wave (k phase) (call sin (+ (* k x) phase)))',
                '(note "A note")',
                '(folder "Waves" (@ collapsed) ' +
                    '(statement (= a 1) (@ slider:(range (- 5) 5 step 0.5))) ' +
                    '(statement (= y (* a (call wave 2 (/ tau 4)))) (@ use:emphasis)) ' +
                    '(statement (= y (call wave 1 0)) (@{} color:(call rgb 40 120 200) lineStyle:DASHED)))',
                '(table (column x [1 2 3]) (column y [1 4 9] (@ lines)))',
                '(= n 0)',
                '(ticker (-> n (+ n dt)) (@ minStep:50 playing))',
            ].join('\n'),
        );
    });
});

describe('spans', () => {
    const source = 'folder "W" { @ collapsed\n  y = 2x + 1 @ color: RED\n}\nz = f(a, b)';
    const { file } = parse(source);
    const text = (span: { start: number; end: number }) => source.slice(span.start, span.end);

    test('statements cover exactly what they were written as', () => {
        assert.equal(text(file.span), source);
        assert.deepEqual(
            file.statements.map(statement => text(statement.span)),
            ['folder "W" { @ collapsed\n  y = 2x + 1 @ color: RED\n}', 'z = f(a, b)'],
        );
    });

    test('every node sits inside its parent, and leaves cover their text', () => {
        const folder = file.statements[0];
        assert.equal(folder.kind, 'FolderStatement');
        if (folder.kind !== 'FolderStatement') return;
        assert.equal(text(folder.metadata!.span), '@ collapsed');
        const inner = folder.body[0] as ExpressionStatement;
        assert.equal(text(inner.span), 'y = 2x + 1 @ color: RED');
        assert.equal(text(inner.expression.span), 'y = 2x + 1');
        assert.equal(text(inner.metadata!.span), '@ color: RED');
        assert.equal(text(inner.metadata!.entries[0].span), 'color: RED');
        assert.equal(text(inner.metadata!.entries[0].key.span), 'color');

        const comparison = inner.expression;
        assert.equal(comparison.kind, 'Comparison');
        if (comparison.kind !== 'Comparison') return;
        assert.equal(text(comparison.operands[1].span), '2x + 1');
        const sum = comparison.operands[1];
        if (sum.kind !== 'Binary') return assert.fail('expected a sum');
        assert.equal(text(sum.left.span), '2x');

        const call = (file.statements[1] as ExpressionStatement).expression;
        if (call.kind !== 'Comparison') return assert.fail('expected a comparison');
        assert.equal(text(call.operands[1].span), 'f(a, b)');
    });

    test('a bracket spread over lines is spanned to its closer', () => {
        const spread = 'y = {\n  x < 0: 1,\n  2\n} @ hidden';
        const statement = parse(spread).file.statements[0] as ExpressionStatement;
        assert.equal(spread.slice(statement.span.start, statement.span.end), spread);
        const comparison = statement.expression;
        if (comparison.kind !== 'Comparison') return assert.fail('expected a comparison');
        const piecewise = comparison.operands[1];
        assert.equal(
            spread.slice(piecewise.span.start, piecewise.span.end),
            '{\n  x < 0: 1,\n  2\n}',
        );
    });

    test('a definition naming a run spans the run', () => {
        const source = 'R = a -> 1, b -> 2';
        const expression = (parse(source).file.statements[0] as ExpressionStatement).expression;
        if (expression.kind !== 'Comparison') return assert.fail('expected a comparison');
        const run = expression.operands[1];
        assert.equal(source.slice(run.span.start, run.span.end), 'a -> 1, b -> 2');
        assert.deepEqual(expression.span, { start: 0, end: source.length });
    });
});
