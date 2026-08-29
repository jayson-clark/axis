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
