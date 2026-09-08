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

    test('brackets a denominator a command follows, which Axis writes as a name', () => {
        // `\\frac{\\pi}{2}\\operatorname{floor}(x)` is a fraction times a floor, but
        // the floor loses its backslash on the way to Axis and `pi/2floor(x)`
        // divides by the whole of `2floor(x)` - a different number, and one
        // Desmos accepts without a word. The decision is made on what the tail
        // converts to, not on the LaTeX it arrives as.
        assert.equal(
            convertFromLatex('\\frac{\\pi}{2}\\operatorname{floor}\\left(x\\right)'),
            'pi/(2)floor(x)',
        );
        assert.equal(convertFromLatex('\\frac{a}{b}\\sqrt{x}'), 'a/(b)sqrt(x)');
        assert.equal(convertFromLatex('\\frac{a}{b}\\pi'), 'a/(b)pi');

        // A command that converts to something a name cannot run into leaves
        // the denominator alone.
        assert.equal(convertFromLatex('\\frac{a}{b}\\cdot c'), 'a/b*c');
    });

    test('reads a fraction inside a fraction', () => {
        assert.equal(convertFromLatex('\\frac{\\frac{a}{b}}{2}'), '(a/b)/2');
    });

    test('drops the space a function command keeps to hold itself apart', () => {
        // Desmos writes `\\max \\left(…\\right)` for a name typed into its editor.
        // The space is the backslash's, not the expression's, and reading it
        // back as one leaves `max (a,b)` where the graph said `max(a,b)`.
        assert.equal(convertFromLatex('\\max \\left(a,b\\right)'), 'max(a,b)');

        // Where a letter or digit really does follow, the space goes back.
        assert.equal(convertFromLatex('\\cos x'), 'cos x');
        assert.equal(convertFromLatex('\\cos 2x'), 'cos 2x');
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

describe('the bare operators', () => {
    test('reads each back as the word it came from', () => {
        assert.equal(convertFromLatex('\\operatorname{width}'), 'width');
        assert.equal(convertFromLatex('\\frac{\\operatorname{height}}{4}'), 'height/4');
    });

    test('puts back the space an operator ran into', () => {
        // `\operatorname{for}i` closed up would be the single word `fori`.
        assert.equal(
            convertFromLatex('L=[i\\operatorname{for}i=[1,...,10]]'),
            'L=[i for i=[1,...,10]]',
        );
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
    'a = random()',
    'R = random(5)',
    'y = height / 4',
    'y = width * height',
    'heightMap = 2',
    'L = [i for i = [1, ..., 10]]',
    'S = [i ^ 2 for i = [1, ..., 10]]',
];

describe('round trip', () => {
    for (const expression of EXPRESSIONS) {
        test(expression, () => {
            const latex = convertToLatex(expression);
            assert.equal(convertToLatex(convertFromLatex(latex)), latex);
        });
    }
});

describe('bars and fractions', () => {
    test('keeps a bar holding another bar as bars', () => {
        // A bar opens or closes according to what precedes it, so the inner
        // pair here is recovered: the `(` in front of it can only be opening.
        assert.equal(
            convertFromLatex('\\left|\\frac{x}{\\left|a-b\\right|}\\right|'),
            '|x/(|a-b|)|',
        );
    });

    test('falls back to abs where the bars cannot be paired back', () => {
        // `|a|b||` reads as `abs(a)` times `b` and then a bar with nothing to
        // close, which is not what Desmos was holding. `abs` nests whatever
        // sits inside it, so it says what the bars cannot.
        assert.equal(convertFromLatex('\\left|a\\left|b\\right|\\right|'), 'abs(a|b|)');
    });

    test('leaves a bar that holds no other bar as bars', () => {
        assert.equal(convertFromLatex('\\left|a-b\\right|'), '|a-b|');
    });

    test('brackets a denominator an accessor would otherwise take', () => {
        // `(a+b)/2.x` divides by `2.x`; the accessor belongs to the fraction.
        assert.equal(convertFromLatex('\\frac{a+b}{2}.x'), '(a+b)/(2).x');
    });
});

describe('scripts', () => {
    test('reads a summation with its bounds', () => {
        assert.equal(convertFromLatex('\\sum_{n=0}^{z-1}x'), '\\sum_(n=0)^(z-1)x');
    });

    test('does not bracket an exponent that is bracketed already', () => {
        // Both would give `x^((n-1))`, and Desmos draws the inner pair.
        assert.equal(convertFromLatex('x^{\\left(n-1\\right)}'), 'x^(n-1)');
    });

    test('brackets an exponent that is more than one group', () => {
        assert.equal(convertFromLatex('x^{\\left(a\\right)+\\left(b\\right)}'), 'x^((a)+(b))');
    });

    test('separates letters that latex writes as a product', () => {
        // `yn` is `y` times `n` in latex; the same two letters closed up in
        // Axis are the single name `y_{n}`, which is a different graph.
        assert.equal(convertFromLatex('yn'), 'y n');
        assert.equal(convertFromLatex('abc'), 'a b c');
        assert.equal(convertFromLatex('a_{bc}'), 'abc');
    });

    test('leaves a subscript that spells a name as the name', () => {
        assert.equal(convertFromLatex('a_{full}'), 'afull');
    });
});

describe('a function and what it takes', () => {
    test('keeps a function apart from an argument opening with a digit', () => {
        // `cos2pi t` closed up is the single name `cos2pi`, which compiles to
        // `c_{os2pi}` - a different graph than the one read from.
        assert.equal(convertFromLatex('\\cos2\\pi t'), 'cos 2pi t');
        assert.equal(convertFromLatex('\\sin2\\pi t'), 'sin 2pi t');
    });

    test("reads Desmos' explicit spaces as plain ones", () => {
        // Left as they were, the backslash reaches the compiler and comes back
        // escaped as `\\`, which is not a space and not valid latex.
        assert.equal(convertFromLatex('\\left(a,\\ b\\right)'), '(a, b)');

        // `\\space` is the other one Desmos writes, and like any control word
        // it ends at the first character that is not a letter.
        assert.equal(convertFromLatex('x<1:\\space1'), 'x<1: 1');
    });

    test('leaves a bracketed argument alone', () => {
        assert.equal(convertFromLatex('\\cos\\left(2\\pi t\\right)'), 'cos(2pi t)');
    });
});
