import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { convertToLatex } from '../dist/index.js';

describe('operators', () => {
    test('leaves a plain assignment alone', () => {
        assert.equal(convertToLatex('y = x^2'), 'y=x^2');
    });

    test('writes multiplication as \\cdot', () => {
        assert.equal(convertToLatex('2*x'), '2\\cdot x');
    });

    test('writes the inequalities as \\le and \\ge', () => {
        assert.equal(convertToLatex('x <= 3'), 'x\\le3');
        assert.equal(convertToLatex('x >= 3'), 'x\\ge3');
    });

    test('writes the action arrow as \\to', () => {
        assert.equal(convertToLatex('a -> a + 1'), 'a\\to a+1');
    });

    test('sizes parentheses', () => {
        assert.equal(convertToLatex('(x)'), '\\left(x\\right)');
    });
});

describe('division', () => {
    test('makes a fraction of two groups', () => {
        assert.equal(convertToLatex('(a+b) / (c+d)'), '\\frac{a+b}{c+d}');
    });

    test('makes a fraction of two simple terms', () => {
        assert.equal(convertToLatex('x / 2'), '\\frac{x}{2}');
        assert.equal(convertToLatex('1.5 / 2'), '\\frac{1.5}{2}');
    });

    test('divides a whole call, not the group it takes', () => {
        // `f\frac{x}{2}` is a different expression, and one Desmos reports on.
        assert.equal(convertToLatex('f(x) / 2'), '\\frac{f\\left(x\\right)}{2}');
        assert.equal(convertToLatex('2 / f(x)'), '\\frac{2}{f\\left(x\\right)}');
        assert.equal(
            convertToLatex('sin(x) / cos(x)'),
            '\\frac{\\sin\\left(x\\right)}{\\cos\\left(x\\right)}',
        );
    });

    test('reads a call however deeply its arguments nest', () => {
        assert.equal(convertToLatex('f(g(x)) / 2'), '\\frac{f\\left(g\\left(x\\right)\\right)}{2}');
    });

    test('leaves a coefficient outside the fraction, where it means the same', () => {
        // `3(x)` is three times a group rather than a call, so the 3 is not
        // part of the numerator - and `2/3(x)` stays two thirds of x.
        assert.equal(convertToLatex('3(x) / 2'), '3\\frac{x}{2}');
        assert.equal(convertToLatex('2 / 3(x)'), '\\frac{2}{3}\\left(x\\right)');
    });

    test('leaves a `/` it cannot read the operands of alone', () => {
        // Desmos reads it as division either way.
        assert.equal(convertToLatex('{x < 0: 1, 2} / 3'), '\\left\\{x<0:1,2\\right\\}/3');
    });
});

describe('functions', () => {
    test('writes a true LaTeX command bare', () => {
        assert.equal(convertToLatex('sin(x)'), '\\sin\\left(x\\right)');
    });

    test('prefers the longest name, so arcsin is not clipped to arc + sin', () => {
        assert.equal(convertToLatex('arcsin(x)'), '\\arcsin\\left(x\\right)');
    });

    test('writes a function with no LaTeX command as \\operatorname', () => {
        assert.equal(convertToLatex('mean(L)'), '\\operatorname{mean}\\left(L\\right)');
    });

    test('has its own forms for sqrt and nthroot', () => {
        assert.equal(convertToLatex('sqrt(x)'), '\\sqrt{x}');
        assert.equal(convertToLatex('nthroot(x, 3)'), '\\sqrt[3]{x}');
    });

    test('leaves abs a function of its own', () => {
        assert.equal(convertToLatex('abs(x)'), '\\operatorname{abs}\\left(x\\right)');
    });

    test('closes a shaped form on its own parenthesis, not a nested one', () => {
        assert.equal(convertToLatex('sqrt(sin(x))'), '\\sqrt{\\sin\\left(x\\right)}');
        assert.equal(convertToLatex('nthroot(sqrt(x + 1), 3)'), '\\sqrt[3]{\\sqrt{x+1}}');
    });

    test('leaves a shaped form it cannot read alone', () => {
        assert.equal(convertToLatex('nthroot(x)'), '\\operatorname{nthroot}\\left(x\\right)');
    });
});

describe('absolute value', () => {
    test('sizes a pair of bars', () => {
        assert.equal(convertToLatex('y = |x|'), 'y=\\left|x\\right|');
    });

    test('pairs each set of bars in turn', () => {
        assert.equal(convertToLatex('|x| + |y|'), '\\left|x\\right|+\\left|y\\right|');
    });

    test('sizes the bars around a tall expression', () => {
        assert.equal(convertToLatex('|x / 2|'), '\\left|\\frac{x}{2}\\right|');
    });
});

describe('names', () => {
    test('subscripts everything after the first letter', () => {
        assert.equal(convertToLatex('abc = 2'), 'a_{bc}=2');
    });

    test('writes a Greek constant as its command', () => {
        assert.equal(convertToLatex('2*pi'), '2\\cdot\\pi');
    });

    test('subscripts a name that starts with a constant', () => {
        assert.equal(convertToLatex('alpha2 = 1'), '\\alpha_{2}=1');
    });

    test('braces an explicit subscript', () => {
        assert.equal(convertToLatex('x_1 = 2'), 'x_{1}=2');
    });

    test('writes infinity as a single \\infty', () => {
        assert.equal(convertToLatex('infinity'), '\\infty');
        assert.equal(convertToLatex('x / infinity'), '\\frac{x}{\\infty}');
    });
});

describe('the bare operators', () => {
    test('writes each as an \\operatorname of its own', () => {
        assert.equal(convertToLatex('width'), '\\operatorname{width}');
        assert.equal(convertToLatex('height'), '\\operatorname{height}');
    });

    test('keeps an operator whole inside an expression', () => {
        assert.equal(convertToLatex('y = height / 4'), 'y=\\frac{\\operatorname{height}}{4}');
    });

    test('leaves a name that merely opens with one a variable', () => {
        // Unlike a constant, an operator does not carry the rest of a longer
        // name as a subscript: `heightMap` is a variable somebody named.
        assert.equal(convertToLatex('heightMap = 2'), 'h_{eightMap}=2');
        assert.equal(convertToLatex('force = 1'), 'f_{orce}=1');
    });

    test('leaves an operator that names a subscript alone', () => {
        assert.equal(convertToLatex('a_for = 1'), 'a_{for}=1');
    });

    test('joins a list comprehension with for', () => {
        assert.equal(
            convertToLatex('L = [i for i = [1, ..., 10]]'),
            'L=[i\\operatorname{for}i=[1,...,10]]',
        );
        assert.equal(
            convertToLatex('S = [i ^ 2 for i = [1, ..., 10]]'),
            'S=[i^2\\operatorname{for}i=[1,...,10]]',
        );
    });

    test('writes random as the call it is, not a variable', () => {
        assert.equal(convertToLatex('a = random()'), 'a=\\operatorname{random}\\left(\\right)');
        assert.equal(convertToLatex('R = random(5)'), 'R=\\operatorname{random}\\left(5\\right)');
    });
});

describe('braces', () => {
    test('sizes piecewise braces', () => {
        assert.equal(
            convertToLatex('{x < 0: -x, x >= 0: x}'),
            '\\left\\{x<0:-x,x\\ge0:x\\right\\}',
        );
    });

    test('does not convert braces it introduced itself', () => {
        assert.equal(convertToLatex('sqrt(x)'), '\\sqrt{x}');
    });
});

test('keeps the space a LaTeX command needs before a letter', () => {
    assert.equal(convertToLatex('2*t'), '2\\cdot t');
    assert.equal(convertToLatex('2*3'), '2\\cdot3');
});
