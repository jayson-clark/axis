import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    debugTree,
    parse,
    parseExpression,
    printExpression,
    printStatement,
    sameTree,
    stripParens,
    type Expression,
    type Statement,
} from '../dist/index.js';
import {
    abs,
    act,
    add,
    bigOp,
    call,
    cmp,
    color,
    deriv,
    div,
    eq,
    fact,
    forB,
    id,
    imp,
    index,
    list,
    member,
    meta,
    mul,
    neg,
    num,
    paren,
    piecewise,
    pos,
    pow,
    prime,
    prop,
    range,
    seeded,
    seq,
    slider,
    statementValue,
    str,
    sub,
    tuple,
    withB,
} from './trees.mts';

/** Print a tree, and insist it reads back as itself. */
function print(tree: Expression): string {
    const text = printExpression(tree);
    const { expression, diagnostics } = parseExpression(text);
    assert.deepEqual(diagnostics, [], `${text} did not parse`);
    assert.ok(
        sameTree(expression, tree),
        `${text} reads back as ${debugTree(stripParens(expression))}, not ${debugTree(tree)}`,
    );
    return text;
}

/** Parse a statement and print it again. */
function reprint(source: string, options = {}): string {
    const { file, diagnostics } = parse(source);
    assert.deepEqual(diagnostics, []);
    assert.equal(file.statements.length, 1);
    return printStatement(file.statements[0], options);
}

describe('printExpression: every node', () => {
    test('atoms', () => {
        assert.equal(print(num('0.5')), '0.5');
        assert.equal(print(num('.5')), '.5');
        assert.equal(print(num('1e-3')), '1e-3');
        assert.equal(print(id('x_1')), 'x_1');
        assert.equal(print(color('#c74440')), '#c74440');
        assert.equal(print(add(str('a'), 1)), '"a" + 1');
    });

    test('strings are escaped the three ways the lexer reads', () => {
        assert.equal(print(add(str('say "hi"\\\n'), 1)), '"say \\"hi\\"\\\\\\n" + 1');
    });

    test('brackets', () => {
        assert.equal(print(paren(add(1, 2))), '(1 + 2)');
        assert.equal(print(tuple(1, 2)), '(1, 2)');
        assert.equal(print(tuple('a')), '(a,)');
        assert.equal(print(list()), '[]');
        assert.equal(print(list(1, range(2, 10))), '[1, 2...10]');
        assert.equal(
            print(list(forB(call('f', 'i'), ['i', list(range(1, 10))]))),
            '[f(i) for i = [1...10]]',
        );
        assert.equal(print(abs(sub('x', 1))), '|x - 1|');
    });

    test('piecewise', () => {
        assert.equal(print(piecewise([[cmp('x', '<', 0), neg('x')]], 'x')), '{x < 0: -x, x}');
        assert.equal(print(piecewise([[cmp('x', '>', 0), null]])), '{x > 0}');
        assert.equal(
            print(
                piecewise([
                    [cmp('x', '>', 0), null],
                    [cmp('x', '<', 2), null],
                ]),
            ),
            '{x > 0, x < 2}',
        );
        assert.equal(print(piecewise([])), '{}');
    });

    test('operators are spaced, a sign is not', () => {
        assert.equal(print(add('a', mul('b', 'c'))), 'a + b * c');
        assert.equal(print(sub('a', neg('b'))), 'a - -b');
        assert.equal(print(pos('x')), '+x');
        assert.equal(print(neg(neg('x'))), '--x');
        assert.equal(print(pow('x', 2)), 'x ^ 2');
        assert.equal(print(cmp(1, '<', 'x', '<=', 2)), '1 < x <= 2');
    });

    test('postfix', () => {
        assert.equal(print(call('f', 'a', 'b')), 'f(a, b)');
        assert.equal(print(call('random')), 'random()');
        assert.equal(print(index('L', range(2, 5))), 'L[2...5]');
        assert.equal(print(member('P', 'x')), 'P.x');
        assert.equal(print(member(call('f', 1), 'count')), 'f(1).count');
        assert.equal(print(fact('n')), 'n!');
        assert.equal(print(fact(add('n', 1))), '(n + 1)!');
    });

    test('actions, runs, with and for', () => {
        assert.equal(print(act('a', add('a', 1))), 'a -> a + 1');
        assert.equal(print(seq(act('a', 1), act('b', 2))), 'a -> 1, b -> 2');
        assert.equal(print(withB(mul('a', 'x'), ['a', 2], ['b', 3])), 'a * x with a = 2, b = 3');
        assert.equal(print(forB('i', ['i', 'L'])), 'i for i = L');
    });
});

describe('printExpression: calculus', () => {
    test('sum, prod and int, with their ranges', () => {
        assert.equal(print(bigOp('sum', 'n', 1, 10, pow('n', 2))), 'sum(n = 1..10, n ^ 2)');
        assert.equal(print(bigOp('int', 't', neg('pi'), 'pi', 't')), 'int(t = -pi..pi, t)');
        assert.equal(print(bigOp('prod', 'k', 1, num('.5'), 'k')), 'prod(k = 1.. .5, k)');
        assert.equal(
            print(bigOp('sum', 'n', add('a', 1), sub('b', 1), add('n', 1))),
            'sum(n = a + 1..b - 1, n + 1)',
        );
    });

    test('primes', () => {
        assert.equal(print(prime('f', 1, 'x')), "f'(x)");
        assert.equal(print(prime('f', 2, 'x')), "f''(x)");
    });

    test('d/dx, bracketed where it would take a factor that is not its own', () => {
        assert.equal(print(deriv('x', pow('x', 2))), 'd/dx x ^ 2');
        assert.equal(print(deriv('x', add('x', 1))), 'd/dx (x + 1)');
        assert.equal(print(add(deriv('x', 'x'), 1)), 'd/dx x + 1');
        assert.equal(print(mul(deriv('x', 'x'), 2)), '(d/dx x) * 2');
        assert.equal(print(imp(deriv('x', 'x'), 'y')), '(d/dx x) y');
        assert.equal(print(mul(neg(deriv('x', 'x')), 2)), '(-d/dx x) * 2');
        assert.equal(print(deriv('x', neg('x'))), 'd/dx (-x)');
        assert.equal(print(deriv('x', list(1, 2))), 'd/dx ([1, 2])');
        assert.equal(print(deriv('x_1', 'x_1')), 'd/dx_1 x_1');
    });
});

describe('printExpression: precedence (spec §5.1)', () => {
    // The consequences table, printed from trees that hold no brackets.
    test('the consequences, from trees', () => {
        assert.equal(print(imp(div(1, 2), 'x')), '1 / 2 x');
        assert.equal(print(div('a', pow('b', 2))), 'a / b ^ 2');
        assert.equal(print(div(pow('x', 2), 3)), 'x ^ 2 / 3');
        assert.equal(print(div(div('a', 'b'), 'c')), 'a / b / c');
        assert.equal(print(neg(pow('x', 2))), '-x ^ 2');
        assert.equal(print(pow(2, neg(1))), '2 ^ -1');
        assert.equal(print(pow('x', 10)), 'x ^ 10');
        assert.equal(print(pow(2, pow(3, 2))), '2 ^ 3 ^ 2');
    });

    test('and the other way round, which needs brackets', () => {
        assert.equal(print(div(1, imp(2, 'x'))), '1 / (2x)');
        assert.equal(print(div('a', div('b', 'c'))), 'a / (b / c)');
        assert.equal(print(pow(pow(2, 3), 2)), '(2 ^ 3) ^ 2');
        assert.equal(print(pow(neg('x'), 2)), '(-x) ^ 2');
        assert.equal(print(neg(imp(2, 'x'))), '-(2x)');
        assert.equal(print(sub('a', sub('b', 'c'))), 'a - (b - c)');
        assert.equal(print(mul(add('a', 'b'), 'c')), '(a + b) * c');
        assert.equal(print(pow(2, neg(pow('x', 2)))), '2 ^ -x ^ 2');
        assert.equal(print(pow(2, neg(imp(2, 'x')))), '2 ^ -(2x)');
        assert.equal(print(cmp(cmp('a', '<', 'b'), '<', 'c')), '(a < b) < c');
        assert.equal(print(act(act('a', 'b'), 'c')), 'a -> b -> c');
        assert.equal(print(act('a', act('b', 'c'))), 'a -> (b -> c)');
    });

    test("a statement's = takes the rest of the statement", () => {
        assert.equal(
            print(eq('reset', seq(act('E', tuple(2, neg(6))), act('n', 0)))),
            'reset = E -> (2, -6), n -> 0',
        );
        assert.equal(print(eq('R', seq('A', 'B'))), 'R = A, B');
        assert.equal(
            print(eq(call('f', 'x'), withB(imp('x', 'n'), ['n', 3]))),
            'f(x) = x n with n = 3',
        );
    });

    test('and anything else starting with `name =` is bracketed so it is not taken for one', () => {
        assert.equal(print(act(eq('R', 'a'), 1)), '(R = a) -> 1');
        assert.equal(
            print(withB(eq(call('f', 'x'), imp('x', 'n')), ['n', 3])),
            '(f(x) = x n) with n = 3',
        );
        assert.equal(print(cmp('a', '=', 'b', '<', 'c')), '(a = b < c)');
        assert.equal(print(cmp('a', '<', 'b', '=', 'c')), 'a < b = c');
        assert.equal(print(eq('y', cmp('a', '<', 'b'))), 'y = a < b');
        assert.equal(print(tuple(act(eq('R', 'a'), 1), 2)), '(R = a -> 1, 2)');
    });

    test('a run where no run can stand is the tuple it reads as', () => {
        assert.equal(printExpression(call('f', seq('a', 'b'))), 'f((a, b))');
    });

    test('a with or for is bracketed when a comma follows it', () => {
        assert.equal(print(tuple(withB('a', ['a', 1]), eq('b', 2))), '((a with a = 1), b = 2)');
        assert.equal(print(tuple(withB('a', ['a', 1]))), '((a with a = 1),)');
        assert.equal(print(call('f', 1, withB('a', ['a', 1]))), 'f(1, a with a = 1)');
        assert.equal(print(list(range(1, withB('a', ['a', 1])), 2)), '[1...(a with a = 1), 2]');
        assert.equal(print(add(withB('a', ['a', 1]), 1)), '(a with a = 1) + 1');
    });
});

describe('printExpression: juxtaposition', () => {
    test('a number sits against what it multiplies', () => {
        assert.equal(print(imp(2, 'x')), '2x');
        assert.equal(print(imp(3, call('cos', 't'))), '3cos(t)');
        assert.equal(print(imp(2, add('x', 1))), '2(x + 1)');
        assert.equal(print(imp(2, abs('x'))), '2|x|');
        assert.equal(print(imp(neg(2), 'x')), '-2x');
        assert.equal(print(imp(2, pow('x', 2))), '2x ^ 2');
    });

    test('two names are spaced so they stay two', () => {
        assert.equal(print(imp('x', 'y')), 'x y');
        assert.equal(print(imp(2, 'pi', 'x')), '2pi x');
        assert.equal(print(imp('x', 2)), 'x 2');
        assert.equal(print(imp(2, 3)), '2 3');
        assert.equal(print(imp(call('sin', 'x'), call('cos', 'x'))), 'sin(x) cos(x)');
        assert.equal(print(imp(pow('x', 2), 'y')), 'x ^ 2 y');
    });

    test('a number is not run into a name that would make it an exponent', () => {
        assert.equal(print(imp(2, 'e2')), '2 e2');
        assert.equal(print(imp(2, 'e')), '2e');
        assert.equal(print(imp(2, 'e_1')), '2e_1');
    });

    test('a name before a bracket would be a call, so it is bracketed itself', () => {
        assert.equal(print(imp('x', add('a', 'b'))), '(x)(a + b)');
        assert.equal(print(imp('x_1', tuple(1, 2))), '(x_1)(1, 2)');
        assert.equal(print(imp(imp(2, 'x'), add('a', 'b'))), '(2x)(a + b)');
        assert.equal(print(imp(pow('x', 'y'), add('a', 'b'))), '(x ^ y)(a + b)');
        assert.equal(print(imp(member('P', 'x'), add('a', 'b'))), '(P.x)(a + b)');
        assert.equal(print(imp(paren('a'), paren('b'))), '(a)(b)');
        assert.equal(print(imp(call('f', 'x'), add('a', 'b'))), 'f(x)(a + b)');
        assert.equal(print(imp(pow('x', 2), add('a', 'b'))), 'x ^ 2 (a + b)');
    });

    test('a right-hand side the parser would not take for one is bracketed', () => {
        assert.equal(print(imp('a', neg('b'))), '(a)(-b)');
        assert.equal(print(imp(2, neg('b'))), '2(-b)');
        assert.equal(print(imp(2, list(1, 2))), '2([1, 2])');
        assert.equal(print(imp('x', str('s'))), '(x)("s")');
        assert.equal(print(imp(2, imp('x', 'y'))), '2(x y)');
        assert.equal(print(imp(2, div('x', 'y'))), '2(x / y)');
    });

    test('a piecewise after an expression restricts it', () => {
        assert.equal(
            print(imp(pow('x', 2), piecewise([[cmp('x', '>', 0), null]]))),
            'x ^ 2 {x > 0}',
        );
    });

    test('inside bars, a bar would close them', () => {
        assert.equal(print(abs(imp('a', abs('b')))), '|(a)(|b|)|');
        assert.equal(print(abs(imp(abs('a'), 'b'))), '||a| b|');
        assert.equal(print(abs(add('a', abs('b')))), '|a + |b||');
        assert.equal(print(imp('a', abs('b'))), 'a |b|');
    });
});

describe('printExpression: random trees read back as themselves', () => {
    // A tree with no brackets in it is what the decompiler hands over; the
    // printer has to find every bracket it needs on its own.
    const SEEDS = 3000;
    test(`${SEEDS} seeds`, () => {
        for (let seed = 1; seed <= SEEDS; seed++) {
            const tree = statementValue(seeded(seed));
            const text = printExpression(tree);
            const { expression, diagnostics } = parseExpression(text);
            assert.deepEqual(diagnostics, [], `seed ${seed}: ${text}`);
            assert.ok(
                sameTree(expression, tree),
                `seed ${seed}: ${text}\n  reads as ${debugTree(stripParens(expression))}\n  built as ${debugTree(tree)}`,
            );
        }
    });
});

describe('printStatement', () => {
    const statement = (
        expression: Expression,
        metadata = null as ReturnType<typeof meta> | null,
    ): Statement => ({
        kind: 'ExpressionStatement',
        expression,
        metadata,
        span: { start: 0, end: 0 },
    });

    test('an expression statement, with and without metadata', () => {
        assert.equal(printStatement(statement(eq('y', pow('x', 2)))), 'y = x ^ 2');
        assert.equal(
            printStatement(
                statement(
                    eq('a', 1),
                    meta([prop('slider', slider(neg(5), 5, 0.5)), prop('playing')]),
                ),
            ),
            'a = 1 @ slider: -5..5 step 0.5, playing',
        );
    });

    test('every form of range', () => {
        const printed = (range: ReturnType<typeof slider>) =>
            printStatement(statement(eq('a', 1), meta([prop('slider', range)])));
        assert.equal(printed(slider(0, null, 1)), 'a = 1 @ slider: 0.. step 1');
        assert.equal(printed(slider(null, 5)), 'a = 1 @ slider: ..5');
        assert.equal(
            printed(slider(0, imp(2, 'pi'), null, 'max')),
            'a = 1 @ slider: 0..2pi soft max',
        );
        assert.equal(
            printed(slider(neg('a'), 'a', div('a', 10), 'both')),
            'a = 1 @ slider: -a..a step a / 10 soft',
        );
        assert.equal(printed(slider(0, '.5')), 'a = 1 @ slider: 0.. .5');
        assert.equal(printed(slider(null, null)), 'a = 1 @ slider: ..');
    });

    test('metadata too long for the line becomes a block', () => {
        const long = statement(
            eq('y', call('sin', 'x')),
            meta([
                prop('color', 'RED'),
                prop('lineWidth', 3),
                prop('label', str('a label long enough to push this line')),
            ]),
        );
        assert.equal(
            printStatement(long, { maxLineLength: 60 }),
            'y = sin(x) @{\n    color: RED\n    lineWidth: 3\n    label: "a label long enough to push this line"\n}',
        );
    });

    test('metadata written as a block stays one', () => {
        assert.equal(
            printStatement(statement(eq('y', 'x'), meta([prop('hidden')], true))),
            'y = x @{\n    hidden\n}',
        );
    });

    test('a run with a bare name in it is written in a block, where the comma is its own', () => {
        assert.equal(
            printStatement(statement(tuple(1, 2), meta([prop('onClick', seq('A', 'B'))]))),
            '(1, 2) @{\n    onClick: A, B\n}',
        );
        assert.equal(
            printStatement(
                statement(
                    tuple(1, 2),
                    meta([prop('onClick', seq(act('a', 1), act('b', 2))), prop('color', 'RED')]),
                ),
            ),
            '(1, 2) @ onClick: a -> 1, b -> 2, color: RED',
        );
    });

    test('continuation lines are indented to the level asked for', () => {
        assert.equal(
            printStatement(statement(eq('y', 'x'), meta([prop('hidden')], true)), {
                level: 2,
                indent: 2,
            }),
            'y = x @{\n      hidden\n    }',
        );
    });

    test('every statement kind', () => {
        assert.equal(
            reprint('config {showGrid:true;xmin:-7}'),
            'config {\n    showGrid: true\n    xmin: -7\n}',
        );
        assert.equal(reprint('config {}'), 'config {}');
        assert.equal(
            reprint('style swatch { pointSize: 14; showLabel }'),
            'style swatch {\n    pointSize: 14\n    showLabel\n}',
        );
        assert.equal(
            reprint('folder "W" { @ collapsed\n a = 1\n}'),
            'folder "W" { @ collapsed\n    a = 1\n}',
        );
        assert.equal(reprint('folder { y = x }'), 'folder {\n    y = x\n}');
        assert.equal(reprint('folder {}'), 'folder {}');
        assert.equal(
            reprint('table { @ color: RED; x = [1, 2]; x ^ 2 @ hidden }'),
            'table { @ color: RED\n    x = [1, 2]\n    x ^ 2 @ hidden\n}',
        );
        assert.equal(
            reprint('macro wave(k,phase)=sin(k*x+phase)'),
            'macro wave(k, phase) = sin(k * x + phase)',
        );
        assert.equal(reprint('macro TAU2=2tau'), 'macro TAU2 = 2tau');
        assert.equal(reprint('macro f()=1'), 'macro f() = 1');
        assert.equal(reprint('macro reset = a->0,b->0'), 'macro reset = a -> 0, b -> 0');
        assert.equal(reprint('import "./lib/waves"'), 'import "./lib/waves"');
        assert.equal(
            reprint('import "./a.axis" as "A" @collapsed:false'),
            'import "./a.axis" as "A" @ collapsed: false',
        );
        assert.equal(
            reprint('image "./beach.png" @ center:(0,1),width:10'),
            'image "./beach.png" @ center: (0, 1), width: 10',
        );
        assert.equal(
            reprint('ticker n->n+dt @ minStep:50,playing'),
            'ticker n -> n + dt @ minStep: 50, playing',
        );
        assert.equal(reprint('ticker R = a -> 1'), 'ticker R = a -> 1');
        assert.equal(reprint('"A \\"quoted\\" note" @ secret'), '"A \\"quoted\\" note" @ secret');
    });

    test('with the source, the author’s one-line block and spread bracket are kept', () => {
        const oneLine = 'config { showGrid: true; xmin: -7 }';
        assert.equal(reprint(oneLine, { source: oneLine }), oneLine);
        const spread = 'y = [\n    1,\n    2\n]';
        assert.equal(reprint(spread, { source: spread }), spread);
    });

    test('an error statement is written back as it was', () => {
        const source = 'folder "No brace"';
        const { file } = parse(source);
        assert.equal(file.statements[0].kind, 'ErrorStatement');
        assert.equal(printStatement(file.statements[0], { source }), source);
    });
});
