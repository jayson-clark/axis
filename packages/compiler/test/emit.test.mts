// ═════════════════════════════════════════════════════════════════════════════
// Expression trees to latex
// ═════════════════════════════════════════════════════════════════════════════
//
// What each tree is written as, character for character. Whether Desmos then
// reads that latex the way the tree means it is a different question, and the
// harness answers it (`packages/harness/test/expressions.test.mts`); this is
// the fast half, pinning the spelling.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Expression } from '@axis-dsl/syntax';
import { emitLatex, identifierLatex } from '../dist/index.js';
import {
    abs,
    act,
    add,
    call,
    deriv,
    integral,
    cmp,
    color,
    div,
    eq,
    fact,
    forB,
    id,
    imp,
    index,
    list,
    member,
    mul,
    neg,
    num,
    paren,
    piecewise,
    pos,
    pow,
    prime,
    prod,
    range,
    seq,
    show,
    str,
    sub,
    sum,
    tuple,
    withB,
} from './support/ast.mts';

/** Each case as `[tree, latex]`, named by its tree. */
function cases(table: [Expression, string][]): void {
    for (const [tree, latex] of table) {
        test(`${show(tree)} → ${latex}`, () => {
            assert.equal(emitLatex(tree), latex);
        });
    }
}

describe('the consequences in spec §5.1', () => {
    cases([
        // 1/2x = (1/2)·x
        [imp(div(1, 2), 'x'), '\\frac{1}{2}x'],
        [div('a', pow('b', 2)), '\\frac{a}{b^{2}}'],
        [div(pow('x', 2), 3), '\\frac{x^{2}}{3}'],
        [div(div('a', 'b'), 'c'), '\\frac{\\frac{a}{b}}{c}'],
        [neg(pow('x', 2)), '-x^{2}'],
        [pow(2, neg(1)), '2^{-1}'],
        [pow('x', 10), 'x^{10}'],
        [pow(2, pow(3, 2)), '2^{3^{2}}'],
    ]);
});

describe('numbers', () => {
    cases([
        [num(3), '3'],
        [num('0.5'), '0.5'],
        [num('.5'), '.5'],
        [num('100'), '100'],
    ]);

    test('writes scientific notation out in full, since Desmos reads 1e3 as 1·e·3', () => {
        assert.equal(emitLatex(num('1e-3')), '0.001');
        assert.equal(emitLatex(num('2.5e3')), '2500');
        assert.equal(emitLatex(num('1.25E+2')), '125');
        assert.equal(emitLatex(num('12e-1')), '1.2');
        assert.equal(emitLatex(num('.5e1')), '5');
        assert.equal(emitLatex(num('0e5')), '0');
    });
});

describe('names (spec §2.3)', () => {
    const names: [string, string][] = [
        ['x', 'x'],
        ['amp', 'a_{mp}'],
        ['abc', 'a_{bc}'],
        ['L1', 'L_{1}'],
        ['x_1', 'x_{1}'],
        ['x_12', 'x_{12}'],
        ['theta', '\\theta'],
        ['theta2', '\\theta_{2}'],
        ['alpha2', '\\alpha_{2}'],
        ['pi', '\\pi'],
        ['tau', '\\tau'],
        ['Delta', '\\Delta'],
        ['infinity', '\\infty'],
        // `eta` is a constant in its own right, not e carrying `ta`, and
        // `epsilon2` is ε₂ - the longest constant a name opens with wins.
        ['eta', '\\eta'],
        ['epsilon2', '\\epsilon_{2}'],
        // Desmos writes e as itself.
        ['e', 'e'],
        ['width', '\\operatorname{width}'],
        ['height', '\\operatorname{height}'],
        ['index', '\\operatorname{index}'],
        // The ticker's time step. Written `dt` it is d·t, which a handler takes
        // without complaint and never advances by (issue #11).
        ['dt', '\\operatorname{dt}'],
        // An operator that merely opens a longer name is a variable somebody
        // named.
        ['heightMap', 'h_{eightMap}'],
        ['force', 'f_{orce}'],
        // A long name with a subscript of its own runs them together, since
        // Desmos has only the one.
        ['amp_2', 'a_{mp2}'],
        ['theta_x', '\\theta_{x}'],
    ];

    for (const [name, latex] of names) {
        test(`${name} → ${latex}`, () => {
            assert.equal(identifierLatex(name), latex);
            assert.equal(emitLatex(id(name)), latex);
        });
    }
});

describe('products', () => {
    cases([
        [imp(2, 'x'), '2x'],
        [imp(2, 'pi', 'x'), '2\\pi x'],
        [imp('pi', 'x'), '\\pi x'],
        [imp('x', 'y'), 'xy'],
        [imp('amp', 'x'), 'a_{mp}x'],
        [imp('theta', 'amp'), '\\theta a_{mp}'],
        // The bug v1 fixed by hand: a coefficient before a function.
        [imp(3, call('cos', 't')), '3\\cos\\left(t\\right)'],
        [imp(paren('a'), paren('b')), '\\left(a\\right)\\left(b\\right)'],
        [imp(2, abs('x')), '2\\left|x\\right|'],
        [imp(pow('x', 2), piecewise([[cmp('x', '>', 0), null]])), 'x^{2}\\left\\{x>0\\right\\}'],
        [imp(fact('n'), 'x'), 'n!x'],
        [mul(2, 'x'), '2\\cdot x'],
        [mul(2, 3), '2\\cdot3'],
        [mul('a', neg('b')), 'a\\cdot-b'],
        [mul('a', mul('b', 'c')), 'a\\cdot\\left(b\\cdot c\\right)'],
        [mul(mul('a', 'b'), 'c'), 'a\\cdot b\\cdot c'],
        [mul('pi', 't'), '\\pi\\cdot t'],
    ]);

    describe('put a \\cdot where juxtaposition would read differently', () => {
        cases([
            // 2 then 3 is 23.
            [imp(2, 3), '2\\cdot3'],
            [imp('x', 2), 'x\\cdot2'],
            [imp('x', num('.5')), 'x\\cdot.5'],
            [imp('x', pow(2, 'y')), 'x\\cdot2^{y}'],
            // 2 then a fraction is the mixed number 2½.
            [imp(2, div(1, 2)), '2\\cdot\\frac{1}{2}'],
            [imp(num('2.5'), div(1, 2)), '2.5\\cdot\\frac{1}{2}'],
            // After a name a fraction is a product already.
            [imp('a', div(1, 2)), 'a\\frac{1}{2}'],
            // A list after anything indexes it.
            [imp('a', list(1, 2)), 'a\\cdot\\left[1,2\\right]'],
        ]);
    });

    describe('bracket what juxtaposition would otherwise take apart', () => {
        cases([
            // With nothing in front of it, `2-x` is a subtraction.
            [imp(2, neg('x')), '2\\left(-x\\right)'],
            [imp('a', imp('b', 'c')), 'a\\left(bc\\right)'],
            [imp(add('a', 'b'), 'c'), '\\left(a+b\\right)c'],
            [imp(neg('a'), 'b'), '-ab'],
        ]);
    });
});

describe('the other operators', () => {
    cases([
        [add('a', 'b'), 'a+b'],
        [sub('a', sub('b', 'c')), 'a-\\left(b-c\\right)'],
        [sub(sub('a', 'b'), 'c'), 'a-b-c'],
        [sub('a', add('b', 'c')), 'a-\\left(b+c\\right)'],
        [add('a', mul('b', 'c')), 'a+b\\cdot c'],
        [mul(add('a', 'b'), 'c'), '\\left(a+b\\right)\\cdot c'],
        // Desmos reads a negation on the right of a sum as one: 1--2 is 3.
        [sub(1, neg(2)), '1--2'],
        [add(1, neg(2)), '1+-2'],
        [neg(neg('x')), '--x'],
        [pos('x'), '+x'],
        [neg(add('a', 'b')), '-\\left(a+b\\right)'],
        [neg(imp(2, 'x')), '-\\left(2x\\right)'],
        [neg(div('a', 'b')), '-\\frac{a}{b}'],
        [div(1, neg('x')), '\\frac{1}{-x}'],
        [div(add('a', 'b'), sub('c', 'd')), '\\frac{a+b}{c-d}'],
    ]);

    describe('powers', () => {
        cases([
            [pow(pow(2, 3), 2), '\\left(2^{3}\\right)^{2}'],
            [pow(neg('x'), 2), '\\left(-x\\right)^{2}'],
            [pow(imp(2, 'x'), 2), '\\left(2x\\right)^{2}'],
            // A fraction is braced already, but Desmos would draw its exponent
            // hanging off the denominator.
            [pow(div(1, 2), 2), '\\left(\\frac{1}{2}\\right)^{2}'],
            [pow('x', add('n', 1)), 'x^{n+1}'],
            [pow(call('sin', 'x'), 2), '\\sin\\left(x\\right)^{2}'],
            [pow(call('f', 'x'), 2), 'f\\left(x\\right)^{2}'],
            [pow(fact('n'), 2), 'n!^{2}'],
            [pow(member('P', 'x'), 2), 'P.x^{2}'],
            [pow(call('sqrt', 'x'), 3), '\\sqrt{x}^{3}'],
        ]);
    });

    describe("drop the author's brackets where braces group already", () => {
        cases([
            [pow('x', paren('n')), 'x^{n}'],
            [pow('x', paren(add('n', 1))), 'x^{n+1}'],
            [pow('x', paren(pow(paren(add('a', 'b')), paren(2)))), 'x^{\\left(a+b\\right)^{2}}'],
            [div(paren(add('a', 'b')), paren(add('c', 'd'))), '\\frac{a+b}{c+d}'],
            [call('sqrt', paren(add('x', 1))), '\\sqrt{x+1}'],
            [
                abs(div('x', paren(abs(sub('a', 'b'))))),
                '\\left|\\frac{x}{\\left|a-b\\right|}\\right|',
            ],
        ]);
    });

    describe('keep them everywhere else', () => {
        cases([
            [paren('x'), '\\left(x\\right)'],
            [add(paren(add('a', 'b')), 'c'), '\\left(a+b\\right)+c'],
            [call('f', paren('x')), 'f\\left(\\left(x\\right)\\right)'],
            [imp(3, paren('x')), '3\\left(x\\right)'],
        ]);
    });
});

describe('comparisons', () => {
    cases([
        [eq('y', pow('x', 2)), 'y=x^{2}'],
        [cmp('x', '<=', 3), 'x\\le3'],
        [cmp('x', '>=', 3), 'x\\ge3'],
        [cmp('x', '<=', 'pi'), 'x\\le\\pi'],
        [cmp('x', '>=', 'y'), 'x\\ge y'],
        [cmp(1, '<', 'x', '<', 2), '1<x<2'],
        [cmp(0, '<', 'x', '<=', 3), '0<x\\le3'],
        [eq('y', neg(1)), 'y=-1'],
        [eq(call('f', 'x'), mul(2, 'x')), 'f\\left(x\\right)=2\\cdot x'],
        [cmp(add(pow('x', 2), pow('y', 2)), '<=', 9), 'x^{2}+y^{2}\\le9'],
        [eq('a', eq('b', 'c')), 'a=\\left(b=c\\right)'],
    ]);
});

describe('calls', () => {
    cases([
        [call('sin', 'x'), '\\sin\\left(x\\right)'],
        [call('arcsin', 'x'), '\\arcsin\\left(x\\right)'],
        [call('mean', 'L'), '\\operatorname{mean}\\left(L\\right)'],
        [call('abs', 'x'), '\\operatorname{abs}\\left(x\\right)'],
        [call('max', 'a', 'b'), '\\max\\left(a,b\\right)'],
        [call('random'), '\\operatorname{random}\\left(\\right)'],
        [call('random', 5), '\\operatorname{random}\\left(5\\right)'],
        [call('sqrt', 'x'), '\\sqrt{x}'],
        [call('nthroot', 'x', 3), '\\sqrt[3]{x}'],
        [call('sqrt', call('sin', 'x')), '\\sqrt{\\sin\\left(x\\right)}'],
        [call('nthroot', call('sqrt', add('x', 1)), 3), '\\sqrt[3]{\\sqrt{x+1}}'],
        // A root with the wrong number of arguments has no shape of its own.
        [call('nthroot', 'x'), '\\operatorname{nthroot}\\left(x\\right)'],
        [call('wave', 'x'), 'w_{ave}\\left(x\\right)'],
        [call('f', 'x', 'y'), 'f\\left(x,y\\right)'],
        [call('f', call('g', 'x')), 'f\\left(g\\left(x\\right)\\right)'],
        [div(call('f', 'x'), 2), '\\frac{f\\left(x\\right)}{2}'],
        [div(2, call('f', 'x')), '\\frac{2}{f\\left(x\\right)}'],
        [
            div(call('sin', 'x'), call('cos', 'x')),
            '\\frac{\\sin\\left(x\\right)}{\\cos\\left(x\\right)}',
        ],
        [call('rgb', 177, 75, 75), '\\operatorname{rgb}\\left(177,75,75\\right)'],
        [
            call('polygon', tuple(0, 0), tuple(1, 0), tuple(1, 1)),
            '\\operatorname{polygon}\\left(\\left(0,0\\right),\\left(1,0\\right),\\left(1,1\\right)\\right)',
        ],
        // An argument is a whole value; only a run or a binding needs brackets.
        [call('f', add('a', 'b')), 'f\\left(a+b\\right)'],
        [call('f', seq(act('a', 1), act('b', 2))), 'f\\left(\\left(a\\to1,b\\to2\\right)\\right)'],
    ]);
});

describe('points, lists and ranges', () => {
    cases([
        [tuple(1, 2), '\\left(1,2\\right)'],
        [tuple(neg(2), 4, 'z'), '\\left(-2,4,z\\right)'],
        [list(1, 2, 3), '\\left[1,2,3\\right]'],
        [list(), '\\left[\\right]'],
        [list(range(1, 10)), '\\left[1...10\\right]'],
        [list(1, range(3, 9)), '\\left[1,3...9\\right]'],
        [list(range(1, add('n', 1))), '\\left[1...n+1\\right]'],
        [
            list(tuple(neg(2), 4), tuple(0, 0)),
            '\\left[\\left(-2,4\\right),\\left(0,0\\right)\\right]',
        ],
        [index('L', 1), 'L\\left[1\\right]'],
        [index('L', range(2, 5)), 'L\\left[2...5\\right]'],
        [index('L', cmp('L', '>', 2)), 'L\\left[L>2\\right]'],
        [index(list(1, 2), 1), '\\left[1,2\\right]\\left[1\\right]'],
        [index(add('a', 'b'), 1), '\\left(a+b\\right)\\left[1\\right]'],
    ]);
});

describe('members', () => {
    cases([
        [member('P', 'x'), 'P.x'],
        [member('P', 'y'), 'P.y'],
        [member('L', 'count'), 'L.\\operatorname{count}'],
        [member('L', 'max'), 'L.\\max'],
        [index('i', member('x', 'count')), 'i\\left[x.\\operatorname{count}\\right]'],
        [member(call('f', 'x'), 'x'), 'f\\left(x\\right).x'],
        // `2.x` is the number 2. and then an x.
        [member(num(2), 'x'), '\\left(2\\right).x'],
        [member(div(add('a', 'b'), 2), 'x'), '\\left(\\frac{a+b}{2}\\right).x'],
    ]);
});

describe('factorials, bars and piecewise', () => {
    cases([
        [fact('n'), 'n!'],
        [fact(fact('n')), 'n!!'],
        [fact(add('n', 1)), '\\left(n+1\\right)!'],
        [fact(neg('a')), '\\left(-a\\right)!'],
        [abs('x'), '\\left|x\\right|'],
        [add(abs('x'), abs('y')), '\\left|x\\right|+\\left|y\\right|'],
        [imp(abs('x'), abs('y')), '\\left|x\\right|\\left|y\\right|'],
        [abs(div('x', 2)), '\\left|\\frac{x}{2}\\right|'],
        [piecewise([[cmp('x', '<', 0), neg('x')]], 'x'), '\\left\\{x<0:-x,x\\right\\}'],
        [
            piecewise([
                [cmp('x', '<', 0), neg('x')],
                [cmp('x', '>=', 0), 'x'],
            ]),
            '\\left\\{x<0:-x,x\\ge0:x\\right\\}',
        ],
        [piecewise([[cmp(0, '<', 'x', '<', 3), null]]), '\\left\\{0<x<3\\right\\}'],
        [
            piecewise([
                [cmp('x', '>', 0), null],
                [cmp('x', '<', imp(2, 'pi')), null],
            ]),
            '\\left\\{x>0,x<2\\pi\\right\\}',
        ],
        [div(piecewise([[cmp('x', '<', 0), 1]], 2), 3), '\\frac{\\left\\{x<0:1,2\\right\\}}{3}'],
        // A conditional action.
        [
            piecewise([[cmp('a', '<', 5), act('a', add('a', 1))]]),
            '\\left\\{a<5:a\\to a+1\\right\\}',
        ],
    ]);
});

describe('actions', () => {
    cases([
        [act('a', add('a', 1)), 'a\\to a+1'],
        [act('E', tuple(2, neg(6))), 'E\\to\\left(2,-6\\right)'],
        [act('n', add('n', 'dt')), 'n\\to n+\\operatorname{dt}'],
        // A run is bare: bracketed, Desmos reads a point.
        [seq(act('a', 1), act('b', 2)), 'a\\to1,b\\to2'],
        [seq('A', 'B'), 'A,B'],
        // And so is one that is being named (spec §5.6).
        [eq('A', seq(act('a', 1), act('b', 2))), 'A=a\\to1,b\\to2'],
        [eq('R', seq('A', 'B')), 'R=A,B'],
        [eq('A', act('a', 1)), 'A=a\\to1'],
        [eq(call('f', 'x'), seq(act('a', 'x'), act('b', 2))), 'f\\left(x\\right)=a\\to x,b\\to2'],
        [eq('P', tuple(1, 2)), 'P=\\left(1,2\\right)'],
        [act('a', cmp('b', '=', 1)), 'a\\to b=1'],
    ]);
});

describe('with and for', () => {
    cases([
        [withB(imp('x', 'n'), ['n', 3]), 'xn\\operatorname{with}n=3'],
        [
            eq(call('f', 'x'), withB(imp('x', 'n'), ['n', call('length', 'a')])),
            'f\\left(x\\right)=xn\\operatorname{with}n=\\operatorname{length}\\left(a\\right)',
        ],
        [
            withB(eq(call('f', 'x'), imp('x', 'n')), ['n', 3]),
            'f\\left(x\\right)=xn\\operatorname{with}n=3',
        ],
        [withB('A', ['a', 1], ['b', 2]), 'A\\operatorname{with}a=1,b=2'],
        [
            eq('L', list(forB('i', ['i', list(range(1, 10))]))),
            'L=\\left[i\\operatorname{for}i=\\left[1...10\\right]\\right]',
        ],
        [
            eq('S', list(forB(pow('i', 2), ['i', list(range(1, 10))]))),
            'S=\\left[i^{2}\\operatorname{for}i=\\left[1...10\\right]\\right]',
        ],
        [
            list(forB(add('i', 'j'), ['i', 'L'], ['j', 'M'])),
            '\\left[i+j\\operatorname{for}i=L,j=M\\right]',
        ],
        // Anywhere but alone in a list, the bindings would take the commas
        // after them.
        [
            tuple(withB('a', ['a', 1]), 2),
            '\\left(\\left(a\\operatorname{with}a=1\\right),2\\right)',
        ],
        [withB('a', ['a', cmp('b', '=', 1)]), 'a\\operatorname{with}a=\\left(b=1\\right)'],
        [withB('a', ['theta', 1]), 'a\\operatorname{with}\\theta=1'],
    ]);
});

describe('calculus', () => {
    cases([
        [sum('n', 1, 10, pow('n', 2)), '\\sum_{n=1}^{10}n^{2}'],
        [prod('k', 1, 'n', 'k'), '\\prod_{k=1}^{n}k'],
        [sum('n', sub('a', 1), add('b', 1), 'n'), '\\sum_{n=a-1}^{b+1}n'],
        [sum('theta', 1, 3, 'theta'), '\\sum_{\\theta=1}^{3}\\theta'],
        // Its body is a product at most, as Desmos reads one.
        [sum('n', 1, 3, add('n', 1)), '\\sum_{n=1}^{3}\\left(n+1\\right)'],
        [add(sum('n', 1, 3, 'n'), 1), '\\sum_{n=1}^{3}n+1'],
        // And it takes a factor after it, so one that is not its own is kept out.
        [mul(sum('n', 1, 3, 'n'), 2), '\\left(\\sum_{n=1}^{3}n\\right)\\cdot2'],
        [imp(sum('n', 1, 3, 'n'), 'x'), '\\left(\\sum_{n=1}^{3}n\\right)x'],
        [imp(imp(2, sum('n', 1, 3, 'n')), 'x'), '\\left(2\\sum_{n=1}^{3}n\\right)x'],
        [mul(neg(sum('n', 1, 3, 'n')), 2), '\\left(-\\sum_{n=1}^{3}n\\right)\\cdot2'],
        [pow(sum('n', 1, 3, 'n'), 2), '\\left(\\sum_{n=1}^{3}n\\right)^{2}'],
        [mul(2, sum('n', 1, 3, 'n')), '2\\cdot\\sum_{n=1}^{3}n'],
        // An integral names its variable in its differential.
        [integral('t', 0, 1, pow('t', 2)), '\\int_{0}^{1}t^{2}dt'],
        [integral('t', 0, 1, add('t', 1)), '\\int_{0}^{1}\\left(t+1\\right)dt'],
        [integral('t', 0, 1, 'pi'), '\\int_{0}^{1}\\pi dt'],
        [integral('amp', 0, 1, 'amp'), '\\int_{0}^{1}a_{mp}da_{mp}'],
        [integral('theta', 0, 1, 'theta'), '\\int_{0}^{1}\\theta d\\theta'],
        [pow(integral('t', 0, 1, 't'), 2), '\\left(\\int_{0}^{1}tdt\\right)^{2}'],
        [imp(integral('t', 0, 1, 't'), 'x'), '\\left(\\int_{0}^{1}tdt\\right)x'],
        [imp(2, integral('t', 0, 1, 't')), '2\\int_{0}^{1}tdt'],
        [deriv('x', pow('x', 2)), '\\frac{d}{dx}x^{2}'],
        [deriv('x', add('x', 1)), '\\frac{d}{dx}\\left(x+1\\right)'],
        [deriv('x_1', 'x_1'), '\\frac{d}{dx_{1}}x_{1}'],
        [mul(deriv('x', 'x'), 2), '\\left(\\frac{d}{dx}x\\right)\\cdot2'],
        [imp(2, deriv('x', 'x')), '2\\left(\\frac{d}{dx}x\\right)'],
        [prime('f', 1, 'x'), "f'\\left(x\\right)"],
        [prime('f', 2, 'x'), "f''\\left(x\\right)"],
        [prime('sin', 1, 'x'), "\\sin'\\left(x\\right)"],
        [call('log', 'x', 2), '\\log_{2}\\left(x\\right)'],
        [call('log', 'x', add('b', 1)), '\\log_{b+1}\\left(x\\right)'],
    ]);
});

describe('what has no latex of its own', () => {
    test('writes a colour as the rgb call Desmos has instead', () => {
        assert.equal(emitLatex(color('#c74440')), '\\operatorname{rgb}\\left(199,68,64\\right)');
        assert.equal(emitLatex(color('#fff')), '\\operatorname{rgb}\\left(255,255,255\\right)');
    });

    test('refuses a string, which the checker should have stopped', () => {
        assert.throws(() => emitLatex(str('text')), /string/);
    });

    test('refuses an expression the parser could not read', () => {
        assert.throws(() => emitLatex({ kind: 'ErrorExpression', span: { start: 0, end: 0 } }));
    });
});

describe('a space only where a command would swallow a letter', () => {
    cases([
        [mul(2, 't'), '2\\cdot t'],
        [act('a', 'b'), 'a\\to b'],
        [act('pi', 'b'), '\\pi\\to b'],
        [imp('pi', 'theta'), '\\pi\\theta'],
        [imp('dt', 'x'), '\\operatorname{dt}x'],
        [imp(call('sin', 'x'), 'y'), '\\sin\\left(x\\right)y'],
    ]);
});
