// ═════════════════════════════════════════════════════════════════════════════
// Reading Desmos LaTeX back as Axis
// ═════════════════════════════════════════════════════════════════════════════
//
// Two things are being pinned here. The cases below say what a construct reads
// back as, so the output stays the source somebody would have written; the
// round trip at the bottom says the reading is *right*, by compiling it again
// and demanding the same LaTeX back.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { convertFromLatex, convertToLatex } from '../dist/index.js';

describe('operators', () => {
    test('leaves a plain assignment alone', () => {
        assert.equal(convertFromLatex('y=x^2'), 'y=x^2');
    });

    test('reads \\cdot as multiplication, closing up the space it carries', () => {
        assert.equal(convertFromLatex('2\\cdot x'), '2*x');
    });

    test('spaces the inequalities, which a constant after them would swallow', () => {
        // `x<=pi` compiles to `\lepi`: the command runs into the name behind it.
        assert.equal(convertFromLatex('x\\le3'), 'x <= 3');
        assert.equal(convertFromLatex('x\\ge\\pi'), 'x >= pi');
    });

    test('spaces the action arrow, since -> written closed up would not compile', () => {
        assert.equal(convertFromLatex('a\\to a+1'), 'a -> a+1');
    });

    test('drops the sizing off every delimiter', () => {
        assert.equal(convertFromLatex('\\left(x\\right)'), '(x)');
        assert.equal(convertFromLatex('\\left[1,2\\right]'), '[1,2]');
        assert.equal(convertFromLatex('\\left|x\\right|'), '|x|');
    });

    test('reads a piecewise back as the braces it was written with', () => {
        assert.equal(convertFromLatex('\\left\\{x<0:-1,x>0:1\\right\\}'), '{x<0:-1,x>0:1}');
    });

    test('gives a grouped exponent brackets, since braces are a piecewise', () => {
        assert.equal(convertFromLatex('x^{10}'), 'x^(10)');
    });
});

describe('division', () => {
    test('brackets a fraction the compiler could not otherwise read back', () => {
        assert.equal(convertFromLatex('\\frac{a+b}{c+d}'), '(a+b)/(c+d)');
    });

    test('leaves a fraction of two plain terms bare', () => {
        assert.equal(convertFromLatex('\\frac{x}{2}'), 'x/2');
    });

    test('brackets a numerator that follows a name, which would otherwise join it', () => {
        // `ca/b` compiles with the c inside the numerator.
        assert.equal(convertFromLatex('c\\frac{a}{b}'), 'c(a)/b');
    });

    test('brackets a denominator that a name follows, for the same reason', () => {
        assert.equal(convertFromLatex('\\frac{a}{b}c'), 'a/(b)c');
    });

    test('reads a fraction inside a fraction', () => {
        assert.equal(convertFromLatex('\\frac{\\frac{a}{b}}{2}'), '(a/b)/2');
    });
});

describe('functions', () => {
    test('reads a LaTeX command back as the function it compiles from', () => {
        assert.equal(convertFromLatex('\\sin\\left(x\\right)'), 'sin(x)');
    });

    test('reads an \\operatorname back as the name inside it', () => {
        assert.equal(convertFromLatex('\\operatorname{mean}\\left(L\\right)'), 'mean(L)');
    });

    test('reads the shaped forms back as the calls they came from', () => {
        assert.equal(convertFromLatex('\\sqrt{x}'), 'sqrt(x)');
        assert.equal(convertFromLatex('\\sqrt[3]{x}'), 'nthroot(x, 3)');
    });

    test('reads a call nested inside a shaped one', () => {
        assert.equal(convertFromLatex('\\sqrt{\\sin\\left(x\\right)}'), 'sqrt(sin(x))');
    });
});

describe('names', () => {
    test('closes a subscripted name back up', () => {
        assert.equal(convertFromLatex('s_{tep}\\left(x\\right)'), 'step(x)');
    });

    test('keeps the underscore where closing up would name a built-in', () => {
        // `mean` compiles to \operatorname{mean}, so it cannot be what this
        // variable is called; `m_ean` compiles back to exactly this subscript.
        assert.equal(convertFromLatex('m_{ean}'), 'm_ean');
    });

    test('keeps the underscore where closing up would name a constant', () => {
        // `pi2` compiles to \pi_{2}, which is a different expression entirely.
        assert.equal(convertFromLatex('p_{i2}'), 'p_i2');
    });

    test('reads a constant back as its name', () => {
        assert.equal(convertFromLatex('2\\pi'), '2pi');
        assert.equal(convertFromLatex('\\theta'), 'theta');
        assert.equal(convertFromLatex('\\infty'), 'infinity');
    });

    test('reads a constant carrying a suffix as the one name it is', () => {
        assert.equal(convertFromLatex('\\alpha_{2}'), 'alpha2');
    });

    test('puts back the space between two names Desmos wrote closed up', () => {
        assert.equal(convertFromLatex('a_{bc}x_{1}'), 'abc x1');
    });
});

describe('latex it has no Axis for', () => {
    test('passes an unknown command through as written', () => {
        assert.equal(convertFromLatex('\\lfloor x\\rfloor'), '\\lfloor x\\rfloor');
    });

    test('passes an unknown operatorname through as the name inside it', () => {
        assert.equal(convertFromLatex('\\operatorname{notAThing}\\left(x\\right)'), 'notAThing(x)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The round trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expressions covering every rewriting rule the compiler has, each of which has
 * to survive being read back and compiled again.
 */
const EXPRESSIONS = [
    'y = 2x + 1',
    'y = x^2 - 4x + 3',
    'f(x) = 2 * x / 3',
    'y = (a + b) / (c - d)',
    'y = 1 + x / 2',
    'y = sin(x) + cos(2x)',
    'y = arcsin(x) + arctan(x)',
    'y = 3cos(t)',
    'y = sqrt(x + 1)',
    'y = nthroot(x, 3)',
    'y = abs(x) + |x - 1|',
    'y = mean(L) + stdev(L)',
    'y = a_1 + b_2',
    'amplitude = 3',
    'y = amplitude * sin(x)',
    'alpha2 = 4',
    'y = pi * r^2',
    'y = 2pi * theta',
    'y = infinity',
    'p(x) = {x < 0: -x, x}',
    'y = x^2 {0 < x < 3}',
    'y = sin(x) {x > 0, x < 2pi}',
    'w(x) = {x < -pi: 0, -pi <= x <= pi: sin(x), x > pi: 0}',
    'L = [1, 2, 3, 4, 5]',
    'P = [(-2, 4), (0, 0), (2, 4)]',
    'y = polygon((0, 0), (1, 0), (1, 1))',
    'a -> a + 1',
    'E -> (2, -6)',
    'x^2 + y^2 <= 9',
    'y = rgb(177, 75, 75)',
];

describe('round trip', () => {
    for (const expression of EXPRESSIONS) {
        test(expression, () => {
            const latex = convertToLatex(expression);
            assert.equal(convertToLatex(convertFromLatex(latex)), latex);
        });
    }
});
