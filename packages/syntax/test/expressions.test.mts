import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../dist/index.js';
import { expr, recover, tree } from './support.mts';

describe('precedence (spec §5.1)', () => {
    // The consequences table, one row each, exactly as the spec writes them.
    const consequences: [string, string][] = [
        ['1/2x', '(implicit (/ 1 2) x)'],
        ['a/b^2', '(/ a (^ b 2))'],
        ['x^2/3', '(/ (^ x 2) 3)'],
        ['a/b/c', '(/ (/ a b) c)'],
        ['-x^2', '(- (^ x 2))'],
        ['2^-1', '(^ 2 (- 1))'],
        ['x^10', '(^ x 10)'],
        ['2^3^2', '(^ 2 (^ 3 2))'],
    ];
    for (const [source, shape] of consequences) {
        test(source, () => assert.equal(expr(source), shape));
    }

    test('level 1: with and for are loosest, and take every comma after them', () => {
        assert.equal(expr('x + a with a = 1, b = 2'), '(with (+ x a) (a 1) (b 2))');
        assert.equal(expr('i ^ 2 for i = L'), '(for (^ i 2) (i L))');
        assert.equal(expr('i ^ 2 for i = L, j = M'), '(for (^ i 2) (i L) (j M))');
        assert.equal(expr('x with a = 1 with b = 2'), '(with (with x (a 1)) (b 2))');
    });

    test('level 2: an action run is a sequence', () => {
        assert.equal(expr('a -> 1, b -> 2'), '(run (-> a 1) (-> b 2))');
        assert.equal(expr('A, B, C'), '(run A B C)');
    });

    test('a definition takes the rest of the statement as its value', () => {
        assert.equal(expr('R = a -> 1, b -> 2'), '(= R (run (-> a 1) (-> b 2)))');
        assert.equal(
            expr('reset = E -> (2, -6), n -> 0'),
            '(= reset (run (-> E (tuple 2 (- 6))) (-> n 0)))',
        );
        assert.equal(expr('R = A, B'), '(= R (run A B))');
        assert.equal(expr('R = a -> a + 1'), '(= R (-> a (+ a 1)))');
        assert.equal(expr('f(x) = x n with n = 3'), '(= (call f x) (with (implicit x n) (n 3)))');
        assert.equal(expr('S = i ^ 2 for i = L'), '(= S (for (^ i 2) (i L)))');
    });

    test('only at the top of a statement: a chain, or = in a bracket, keeps its precedence', () => {
        assert.equal(expr('1 < x < 2'), '(chain 1 < x < 2)');
        assert.equal(expr('(R = a -> 1)'), '(paren (-> (= R a) 1))');
        assert.equal(expr('f(y = x, 2)'), '(call f (= y x) 2)');
        assert.equal(expr('a < b = c'), '(chain a < b = c)');
    });

    test('level 3: an action is looser than comparison and arithmetic', () => {
        assert.equal(expr('a -> a + 1'), '(-> a (+ a 1))');
        assert.equal(expr('n -> n + dt'), '(-> n (+ n dt))');
        assert.equal(expr('a -> {x > 0: 1, 0}'), '(-> a (piecewise (if (> x 0) 1) (else 0)))');
    });

    test('level 4: comparisons, chainable', () => {
        for (const op of ['=', '<', '<=', '>', '>=']) {
            assert.equal(expr(`y ${op} x + 1`), `(${op} y (+ x 1))`);
        }
        assert.equal(expr('1 < x < 2'), '(chain 1 < x < 2)');
        assert.equal(expr('0 <= y <= x = 3'), '(chain 0 <= y <= x = 3)');
    });

    test('level 5: + and -, left to right', () => {
        assert.equal(expr('a - b + c'), '(+ (- a b) c)');
        assert.equal(expr('a + b * c'), '(+ a (* b c))');
    });

    test('level 6: * / and juxtaposition bind alike, left to right', () => {
        assert.equal(expr('a * b / c'), '(/ (* a b) c)');
        assert.equal(expr('a / b c'), '(implicit (/ a b) c)');
        assert.equal(expr('a b / c'), '(/ (implicit a b) c)');
        assert.equal(expr('2x * 3'), '(* (implicit 2 x) 3)');
    });

    test('juxtaposition is implicit multiplication', () => {
        assert.equal(expr('2x'), '(implicit 2 x)');
        assert.equal(expr('2pi x'), '(implicit (implicit 2 pi) x)');
        assert.equal(expr('3cos(t)'), '(implicit 3 (call cos t))');
        assert.equal(expr('(a)(b)'), '(implicit (paren a) (paren b))');
        assert.equal(expr('x y'), '(implicit x y)');
        assert.equal(expr('2|x|'), '(implicit 2 (abs x))');
        assert.equal(expr('2x^2'), '(implicit 2 (^ x 2))');
    });

    test('a sign is never juxtaposed: a -b is a subtraction', () => {
        assert.equal(expr('a -b'), '(- a b)');
        assert.equal(expr('a +b'), '(+ a b)');
    });

    test('level 7: prefix signs, looser than ^', () => {
        assert.equal(expr('-x'), '(- x)');
        assert.equal(expr('+x'), '(+ x)');
        assert.equal(expr('--x'), '(- (- x))');
        assert.equal(expr('-2x'), '(implicit (- 2) x)');
        assert.equal(expr('a * -b'), '(* a (- b))');
    });

    test('level 8: ^ is right-associative and its exponent may be negated', () => {
        assert.equal(expr('2^-x^2'), '(^ 2 (- (^ x 2)))');
        assert.equal(expr('e^-t'), '(^ e (- t))');
        assert.equal(expr('x^(1/2)'), '(^ x (paren (/ 1 2)))');
        assert.equal(expr('f(x)^2'), '(^ (call f x) 2)');
        assert.equal(expr('L[1]^2'), '(^ (index L 1) 2)');
    });

    test('level 9: postfix binds tightest', () => {
        assert.equal(expr('f(a, b)'), '(call f a b)');
        assert.equal(expr('f()'), '(call f)');
        assert.equal(expr('L[1]'), '(index L 1)');
        assert.equal(expr('L[2...5]'), '(index L (... 2 5))');
        assert.equal(expr('L[L > 2]'), '(index L (> L 2))');
        assert.equal(expr('P.x'), '(. P x)');
        assert.equal(expr('L.count'), '(. L count)');
        assert.equal(expr('n!'), '(! n)');
        assert.equal(expr('-n!'), '(- (! n))');
        assert.equal(expr('L[1].x!'), '(! (. (index L 1) x))');
        assert.equal(expr('[1, 2][1]'), '(index (list 1 2) 1)');
    });

    test('only an identifier is callable: (f)(x) and f(x)(y) are products', () => {
        assert.equal(expr('(f)(x)'), '(implicit (paren f) (paren x))');
        assert.equal(expr('f(x)(y)'), '(implicit (call f x) (paren y))');
        assert.equal(expr('a(b + 1)'), '(call a (+ b 1))');
    });
});

describe('atoms (spec §5.2)', () => {
    test('numbers keep their text', () => {
        assert.equal(expr('0.50'), '0.50');
        assert.equal(expr('1e-3'), '1e-3');
        assert.equal(expr('.5'), '.5');
    });

    test('identifiers, strings, colours', () => {
        assert.equal(expr('x_12'), 'x_12');
        assert.equal(expr('"a \\"q\\""'), '"a \\"q\\""');
        assert.equal(expr('#c74440'), '#c74440');
    });

    test('parentheses and tuples', () => {
        assert.equal(expr('(a)'), '(paren a)');
        assert.equal(expr('(a, b)'), '(tuple a b)');
        assert.equal(expr('(a, b, c)'), '(tuple a b c)');
        assert.equal(expr('((a))'), '(paren (paren a))');
    });

    test('lists, and ranges inside them', () => {
        assert.equal(expr('[]'), '(list)');
        assert.equal(expr('[a, b, c]'), '(list a b c)');
        assert.equal(expr('[1...10]'), '(list (... 1 10))');
        assert.equal(expr('[1, 3...9]'), '(list 1 (... 3 9))');
        assert.equal(expr('[-n...n]'), '(list (... (- n) n))');
    });

    test("Desmos' own [1, ..., 10] is the same range as [1...10]", () => {
        assert.equal(expr('[1, ..., 10]'), '(list (... 1 10))');
        assert.equal(expr('[1, 3, ..., 9]'), '(list 1 (... 3 9))');
    });

    test('a comprehension is a list holding a for', () => {
        assert.equal(
            expr('[f(i) for i = [1...10]]'),
            '(list (for (call f i) (i (list (... 1 10)))))',
        );
        assert.equal(
            expr('[(a, b) for a = [1...3], b = [1, 2]]'),
            '(list (for (tuple a b) (a (list (... 1 3))) (b (list 1 2))))',
        );
    });

    test('piecewise: branches, otherwise, restrictions', () => {
        assert.equal(expr('{x < 0: -x, x}'), '(piecewise (if (< x 0) (- x)) (else x))');
        assert.equal(expr('{x > 0}'), '(piecewise (if (> x 0)))');
        assert.equal(expr('{x > 0, y > 0}'), '(piecewise (if (> x 0)) (if (> y 0)))');
        assert.equal(
            expr('{x > 0: 1, y > 0, 2}'),
            '(piecewise (if (> x 0) 1) (if (> y 0)) (else 2))',
        );
        assert.equal(
            expr('{x < 0: 1, x < 1: 2, 3}'),
            '(piecewise (if (< x 0) 1) (if (< x 1) 2) (else 3))',
        );
        assert.equal(expr('{x < 0: 1, x < 1: 2}'), '(piecewise (if (< x 0) 1) (if (< x 1) 2))');
        assert.equal(expr('{}'), '(piecewise)');
    });

    test('a piecewise after an expression is a juxtaposed restriction', () => {
        assert.equal(expr('y = x^2 {x > 0}'), '(= y (implicit (^ x 2) (piecewise (if (> x 0)))))');
    });

    test('absolute value', () => {
        assert.equal(expr('|x|'), '(abs x)');
        assert.equal(expr('|x - 1| + 2'), '(+ (abs (- x 1)) 2)');
        assert.equal(expr('||x||'), '(abs (abs x))');
        assert.equal(expr('|f(2|x|)|'), '(abs (call f (implicit 2 (abs x))))');
    });

    test('a bracket spans lines freely', () => {
        assert.equal(expr('[\n  1,\n  2\n]'), '(list 1 2)');
        assert.equal(expr('f(\n a,\n b\n)'), '(call f a b)');
        assert.equal(expr('{\n x < 0: 1,\n 2\n}'), '(piecewise (if (< x 0) 1) (else 2))');
        assert.equal(expr('(a +\n b)'), '(paren (+ a b))');
    });

    test('with and for inside a bracket end at the bracket', () => {
        assert.equal(expr('(x with x = 2) + 1'), '(+ (paren (with x (x 2))) 1)');
        assert.equal(expr('f(a with a = 1, b = 2)'), '(call f (with a (a 1) (b 2)))');
    });

    test('an action inside a piecewise', () => {
        assert.equal(
            expr('{a > 1: a -> 0, a -> a + 1}'),
            '(piecewise (if (> a 1) (-> a 0)) (else (-> a (+ a 1))))',
        );
    });
});

describe('expression statements', () => {
    test('definitions, equations and inequalities are all comparisons', () => {
        assert.equal(tree('f(x) = x^2'), '(= (call f x) (^ x 2))');
        assert.equal(tree('a = 1'), '(= a 1)');
        assert.equal(tree('y < x'), '(< y x)');
        assert.equal(tree('(1, 2)'), '(tuple 1 2)');
        assert.equal(tree('x^2 + 1'), '(+ (^ x 2) 1)');
    });

    test('an action run standing as a statement', () => {
        assert.equal(tree('a -> 1, b -> 2'), '(run (-> a 1) (-> b 2))');
    });

    test('a run is only for statement values: inside brackets a comma is the bracket', () => {
        assert.equal(tree('f(a -> 1, b -> 2)'), '(call f (-> a 1) (-> b 2))');
    });
});

describe('trailing commas', () => {
    test('a trailing comma on its own line still makes a one-element tuple', () => {
        assert.equal(expr('(a,\n)'), '(tuple a)');
        assert.equal(expr('(a,)'), '(tuple a)');
    });

    test('a list or a call may end with one', () => {
        assert.equal(expr('[1, 2,\n]'), '(list 1 2)');
        assert.equal(expr('f(1, 2,)'), '(call f 1 2)');
    });
});

describe('calculus (spec §5.9)', () => {
    test('sum, prod and int name their variable and its range', () => {
        assert.equal(expr('sum(n = 1..10, n^2)'), '(sum n 1 10 (^ n 2))');
        assert.equal(expr('prod(k = 1..n, k)'), '(prod k 1 n k)');
        assert.equal(expr('int(t = 0..x, cos(t))'), '(int t 0 x (call cos t))');
    });

    test('either bound is any expression up to a sum', () => {
        assert.equal(expr('sum(n = a - 1..b + 1, n)'), '(sum n (- a 1) (+ b 1) n)');
        assert.equal(expr('int(t = -pi..2pi, t)'), '(int t (- pi) (implicit 2 pi) t)');
        assert.equal(expr('sum(n = .5.. .5, n)'), '(sum n .5 .5 n)');
    });

    test('a sum is an atom: nothing outside the brackets is its', () => {
        assert.equal(expr('sum(n = 1..3, n) + 1'), '(+ (sum n 1 3 n) 1)');
        assert.equal(expr('2 sum(n = 1..3, n) x'), '(implicit (implicit 2 (sum n 1 3 n)) x)');
        assert.equal(expr('sum(n = 1..3, n) ^ 2'), '(^ (sum n 1 3 n) 2)');
    });

    test('its body is anything an argument can be', () => {
        assert.equal(expr('sum(n = 1..3, n + 1)'), '(sum n 1 3 (+ n 1))');
        assert.equal(expr('sum(n = 1..3, a with a = n)'), '(sum n 1 3 (with a (a n)))');
    });

    test("a prime differentiates a call: f'(x), f''(x)", () => {
        assert.equal(expr("f'(x)"), "(' f x)");
        assert.equal(expr("f''(x) + 1"), "(+ ('' f x) 1)");
        assert.equal(expr("sin'(x)"), "(' sin x)");
    });

    test('d/dx takes the product after it, as a sign does', () => {
        assert.equal(expr('d/dx x^2'), '(d/dx (^ x 2))');
        assert.equal(expr('d/dx x^2 + 1'), '(+ (d/dx (^ x 2)) 1)');
        assert.equal(expr('d/dx 3x * x'), '(d/dx (* (implicit 3 x) x))');
        assert.equal(expr('2 d/dx x^2'), '(implicit 2 (d/dx (^ x 2)))');
        assert.equal(expr('d/dx d/dx x^3'), '(d/dx (d/dx (^ x 3)))');
        assert.equal(expr('d/dt f(t)'), '(d/dt (call f t))');
        assert.equal(expr('d/dx_1 x_1^2'), '(d/dx_1 (^ x_1 2))');
        assert.equal(expr('d/dtheta theta^2'), '(d/dtheta (^ theta 2))');
    });

    test('without an operand after it, d/dx is the division it was', () => {
        assert.equal(expr('d/dx'), '(/ d dx)');
        assert.equal(expr('d/dx - 1'), '(- (/ d dx) 1)');
        assert.equal(expr('d/x y'), '(implicit (/ d x) y)');
    });

    test('the variable of d/dx is spanned over its name alone', () => {
        const { expression } = parseExpression('d/dx x');
        assert.ok(expression.kind === 'Derivative');
        assert.deepEqual(expression.variable.span, { start: 3, end: 4 });
    });

    test('a sum not opened with name = from..to is one diagnostic', () => {
        assert.deepEqual(recover('y = sum(n, n)').codes, ['expected-bounds']);
        assert.deepEqual(recover('y = sum(n = 1, n)').codes, ['expected-bounds']);
        assert.deepEqual(recover('y = int()').codes, ['expected-bounds']);
        assert.deepEqual(recover('y = sum(n = 1..3)').codes, ['expected-expression']);
        assert.deepEqual(recover('y = sum(n = 1..3, n)\nz = 1').codes, []);
    });

    test("a prime without a call is an error: f'", () => {
        assert.deepEqual(recover("y = f'").codes, ['unexpected-token']);
    });
});
