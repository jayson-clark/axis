// ═════════════════════════════════════════════════════════════════════════════
// Latex back to expression trees
// ═════════════════════════════════════════════════════════════════════════════
//
// Two things are pinned here. The cases say what each shape of latex - the
// emitter's, and the looser dialect Desmos writes itself - reads as. The round
// trip at the bottom says the reading is *right*: over a few thousand random
// trees, `parseLatex(emitLatex(tree))` is `tree` again, up to the
// normalisations listed with it, and emitting what was read gives back the
// same latex exactly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Expression } from '@axis-dsl/syntax';
import { emitLatex, LatexParseError, parseLatex, parseLatexStatement } from '../dist/index.js';
import {
    abs,
    act,
    add,
    call,
    deriv,
    integral,
    cmp,
    div,
    eq,
    fact,
    forB,
    id,
    imp,
    index,
    list,
    member,
    method,
    mul,
    neg,
    num,
    paren,
    piecewise,
    pow,
    prime,
    prod,
    range,
    seq,
    shape,
    show,
    sub,
    sum,
    tuple,
    withB,
} from './support/ast.mts';
import { expression, seeded } from './support/generate.mts';

/**
 * Each case as `[latex, tree]`. Brackets are compared too - `Paren` is how a
 * bracket the latex was written with comes back - so the trees here say where
 * they are.
 */
function cases(table: [string, Expression][]): void {
    for (const [latex, tree] of table) {
        test(`${latex} → ${show(tree)}`, () => {
            assert.deepEqual(shape(parseLatex(latex), true), shape(tree, true));
        });
    }
}

describe('what Desmos writes', () => {
    describe('scripts', () => {
        cases([
            ['y=x^2', eq('y', pow('x', 2))],
            ['x^{10}', pow('x', 10)],
            // An unbraced script is one character, as in TeX: x²·3 - a
            // product with a number on its right, which Axis writes `*`.
            ['x^23', mul(pow('x', 2), 3)],
            ['x^n', pow('x', 'n')],
            ['2^{-1}', pow(2, neg(1))],
            ['e^{\\pi}', pow('e', 'pi')],
            ['x^\\pi', pow('x', 'pi')],
            ['2^{3^{2}}', pow(2, pow(3, 2))],
            // The braces group; brackets round all of what they hold do not.
            ['x^{\\left(n-1\\right)}', pow('x', sub('n', 1))],
            ['-x^{2}', neg(pow('x', 2))],
        ]);
    });

    describe('products and fractions', () => {
        cases([
            ['2\\cdot x', mul(2, 'x')],
            ['2\\times x', mul(2, 'x')],
            ['2x', imp(2, 'x')],
            ['2\\pi', imp(2, 'pi')],
            // Each letter is a variable of its own.
            ['yn', imp('y', 'n')],
            ['abc', imp('a', 'b', 'c')],
            ['\\frac{a}{b}', div('a', 'b')],
            ['\\frac12', div(1, 2)],
            ['\\frac{1}{2}x', imp(div(1, 2), 'x')],
            ['c\\frac{a}{b}', imp('c', div('a', 'b'))],
            ['\\frac{a+b}{c+d}', div(add('a', 'b'), add('c', 'd'))],
            ['\\frac{\\frac{a}{b}}{2}', div(div('a', 'b'), 2)],
            ['-\\frac{a}{b}', neg(div('a', 'b'))],
            ['1--2', sub(1, neg(2))],
            ['a\\cdot-b', mul('a', neg('b'))],
            [
                '\\frac{\\pi}{2}\\operatorname{floor}\\left(x\\right)',
                imp(div('pi', 2), call('floor', 'x')),
            ],
            [
                'x^{2}\\left\\{x>0\\right\\}',
                imp(pow('x', 2), piecewise([[cmp('x', '>', 0), null]])),
            ],
            ['\\left(a\\right)\\left(b\\right)', imp(paren('a'), paren('b'))],
            ['2\\left|x\\right|', imp(2, abs('x'))],
        ]);
    });

    describe('names', () => {
        cases([
            ['a_{mp}', id('amp')],
            ['a_{bc}x_{1}', imp('abc', 'x_1')],
            ['x_{1}', id('x_1')],
            ['x_1', id('x_1')],
            ['L_{1}', id('L_1')],
            ['\\theta_{2}', id('theta2')],
            ['\\alpha_{2}', id('alpha2')],
            ['\\theta', id('theta')],
            ['\\infty', id('infinity')],
            ['a_{full}', id('afull')],
            // Closing up would name a function, or π₂.
            ['m_{ean}', id('m_ean')],
            ['p_{i2}', id('p_i2')],
            ['d_{t}', id('d_t')],
            ['\\operatorname{dt}', id('dt')],
            ['\\operatorname{width}', id('width')],
            ['\\frac{\\operatorname{height}}{4}', div('height', 4)],
            ['\\operatorname{index}', id('index')],
        ]);
    });

    describe('calls', () => {
        cases([
            ['\\sin\\left(x\\right)', call('sin', 'x')],
            ['\\operatorname{mean}\\left(L\\right)', call('mean', 'L')],
            ['\\max \\left(a,b\\right)', call('max', 'a', 'b')],
            ['\\sqrt{x}', call('sqrt', 'x')],
            ['\\sqrt[3]{x}', call('nthroot', 'x', 3)],
            ['\\sqrt{\\sin\\left(x\\right)}', call('sqrt', call('sin', 'x'))],
            ['\\sqrt2', call('sqrt', 2)],
            // `step` is a keyword, so the name keeps its subscript apart.
            ['s_{tep}\\left(x\\right)', call('s_tep', 'x')],
            ['f_{or}', id('f_or')],
            ['w_{ave}\\left(x,2\\right)', call('wave', 'x', 2)],
            ['\\operatorname{random}\\left(\\right)', call('random')],
            ['\\operatorname{notAThing}\\left(x\\right)', call('notAThing', 'x')],
            ['3\\cos\\left(t\\right)', imp(3, call('cos', 't'))],
            // A name before a bracket is a call, as `a(b + 1)` is in Axis: the
            // checker decides whether it is really a product (spec §5.3).
            ['a\\left(b+1\\right)', call('a', add('b', 1))],
            ['\\pi\\left(2\\right)', call('pi', 2)],
        ]);

        describe('with no brackets, the argument is the product that follows', () => {
            cases([
                ['\\sin x', call('sin', 'x')],
                ['\\cos 2x', call('cos', imp(2, 'x'))],
                ['\\cos2\\pi t', call('cos', imp(2, 'pi', 't'))],
                // Desmos reads both of these as sin(ab).
                ['\\sin ab', call('sin', imp('a', 'b'))],
                ['\\sin a\\cdot b', call('sin', mul('a', 'b'))],
                ['\\sin x+1', add(call('sin', 'x'), 1)],
                ['\\sin x^{2}', call('sin', pow('x', 2))],
                ['\\sin^{2}x', pow(call('sin', 'x'), 2)],
                ['\\sin^{2}\\left(x\\right)', pow(call('sin', 'x'), 2)],
                ['\\sin^{-1}\\left(x\\right)', call('arcsin', 'x')],
                ['\\ln x', call('ln', 'x')],
            ]);
        });
    });

    describe('comparisons and actions', () => {
        cases([
            ['x\\le3', cmp('x', '<=', 3)],
            ['x\\ge\\pi', cmp('x', '>=', 'pi')],
            ['x\\leq 3', cmp('x', '<=', 3)],
            ['x<=3', cmp('x', '<=', 3)],
            ['1<x<2', cmp(1, '<', 'x', '<', 2)],
            ['f\\left(x\\right)=x^{2}', eq(call('f', 'x'), pow('x', 2))],
            ['a\\to a+1', act('a', add('a', 1))],
            ['a\\rightarrow1', act('a', 1)],
            ['n\\to n+\\operatorname{dt}', act('n', add('n', 'dt'))],
            ['a\\to1,b\\to2', seq(act('a', 1), act('b', 2))],
            // Naming a run makes the `=` hold all of it (spec §5.6).
            ['A=a\\to1,b\\to2', eq('A', seq(act('a', 1), act('b', 2)))],
            ['A=a\\to1', eq('A', act('a', 1))],
            ['R=A,B', eq('R', seq('A', 'B'))],
            ['E\\to\\left(2,-6\\right)', act('E', tuple(2, neg(6)))],
        ]);
    });

    describe('brackets', () => {
        cases([
            ['\\left(x\\right)', paren('x')],
            ['(x)', paren('x')],
            ['\\left(1,2\\right)', tuple(1, 2)],
            ['(1,2)', tuple(1, 2)],
            ['\\left(a,\\ b\\right)', tuple('a', 'b')],
            ['\\left[1,2\\right]', list(1, 2)],
            ['[1,2]', list(1, 2)],
            ['\\left[\\right]', list()],
            ['\\left[1...10\\right]', list(range(1, 10))],
            ['\\left[1,3...9\\right]', list(1, range(3, 9))],
            // How v1 wrote a range.
            ['\\left[1,...,10\\right]', list(range(1, 10))],
            ['\\left|x\\right|', abs('x')],
            ['|x|', abs('x')],
            ['\\left|\\frac{x}{\\left|a-b\\right|}\\right|', abs(div('x', abs(sub('a', 'b'))))],
            ['\\left|a\\left|b\\right|\\right|', abs(imp('a', abs('b')))],
            ['{a+b}', add('a', 'b')],
        ]);
    });

    describe('piecewise', () => {
        cases([
            [
                '\\left\\{x<0:-1,x>0:1\\right\\}',
                piecewise([
                    [cmp('x', '<', 0), neg(1)],
                    [cmp('x', '>', 0), 1],
                ]),
            ],
            // A last element with no `:` after one that had it is the otherwise…
            ['\\left\\{x<0:-x,x\\right\\}', piecewise([[cmp('x', '<', 0), neg('x')]], 'x')],
            // …and one where none has it is a restriction.
            [
                '\\left\\{x>0,x<2\\right\\}',
                piecewise([
                    [cmp('x', '>', 0), null],
                    [cmp('x', '<', 2), null],
                ]),
            ],
            ['\\{x>0\\}', piecewise([[cmp('x', '>', 0), null]])],
            ['\\left\\{x<1:\\space1\\right\\}', piecewise([[cmp('x', '<', 1), 1]])],
            [
                '\\left\\{a<5:a\\to a+1\\right\\}',
                piecewise([[cmp('a', '<', 5), act('a', add('a', 1))]]),
            ],
        ]);
    });

    describe('postfix', () => {
        cases([
            ['n!', fact('n')],
            ['n!!', fact(fact('n'))],
            ['P.x', member('P', 'x')],
            ['L.\\operatorname{count}', member('L', 'count')],
            ['L.\\max', member('L', 'max')],
            ['i\\left[x.\\operatorname{count}\\right]', index('i', member('x', 'count'))],
            ['\\frac{a+b}{2}.x', member(div(add('a', 'b'), 2), 'x')],
            ['D.\\operatorname{cdf}\\left(1\\right)', method('D', 'cdf', 1)],
            ['D.\\operatorname{cdf}\\left(-1,1\\right)', method('D', 'cdf', neg(1), 1)],
            [
                'T.\\operatorname{conf}\\left(0.95\\right).\\operatorname{upper}',
                member(method('T', 'conf', 0.95), 'upper'),
            ],
            ['L\\left[2\\right]', index('L', 2)],
            ['L\\left[2...5\\right]', index('L', range(2, 5))],
            ['L\\left[L>2\\right]', index('L', cmp('L', '>', 2))],
            ['L[1,2]', index('L', list(1, 2))],
            // Brackets after anything index it, which is Desmos' reading too.
            ['2\\left[1,2\\right]', index(2, list(1, 2))],
            ['x^{2}!', fact(pow('x', 2))],
        ]);
    });

    describe('with and for', () => {
        cases([
            ['a\\operatorname{with}a=5', withB('a', ['a', 5])],
            [
                'f\\left(x\\right)=xn\\operatorname{with}n=3',
                withB(eq(call('f', 'x'), imp('x', 'n')), ['n', 3]),
            ],
            [
                'L=\\left[i\\operatorname{for}i=\\left[1,...,10\\right]\\right]',
                eq('L', list(forB('i', ['i', list(range(1, 10))]))),
            ],
            [
                '\\left[i+j\\operatorname{for}i=\\left[1,2\\right],j=\\left[10,20\\right]\\right]',
                list(forB(add('i', 'j'), ['i', list(1, 2)], ['j', list(10, 20)])),
            ],
            ['a\\operatorname{with}\\theta=1', withB('a', ['theta', 1])],
            ['\\left(a\\operatorname{with}a=1\\right),2', seq(paren(withB('a', ['a', 1])), 2)],
        ]);
    });
});

describe('slices with an end left off', () => {
    cases([
        ['L\\left[2...\\right]', index('L', range(2, null))],
        ['L\\left[...3\\right]', index('L', range(null, 3))],
        ['L\\left[2,...\\right]', index('L', range(2, null))],
        ['L\\left[1,3...\\right]', index('L', list(1, range(3, null)))],
    ]);
});

describe('regressions', () => {
    cases([
        ['y_{1}\\sim mx_{1}+b', cmp('y_1', '~', add(imp('m', 'x_1'), 'b'))],
        [
            'M\\sim aL^{2}\\left\\{L>2\\right\\}',
            cmp('M', '~', imp('a', pow('L', 2), piecewise([[cmp('L', '>', 2), null]]))),
        ],
    ]);
});

describe('geometry tokens', () => {
    cases([
        ['\\token{12}', id('$12')],
        ['\\token{12}=\\left(1,2\\right)', eq('$12', tuple(1, 2))],
        ['\\token{3}\\left(\\token{2}\\right)', call('$3', '$2')],
        ['\\token{2}.\\operatorname{length}', member('$2', 'length')],
    ]);
});

describe('a number with nothing after its point', () => {
    cases([
        ['3.', num(3)],
        ['\\left(2.,-0.\\right)', tuple(2, neg(0))],
        ['x\\le31.', cmp('x', '<=', 31)],
        ['3.\\left(y+1\\right)', imp(3, paren(add('y', 1)))],
        ['1.y-1.2', sub(imp(1, 'y'), 1.2)],
        ['2.x', imp(2, 'x')],
        ['P_1.x', member('P_1', 'x')],
        ['P_1.\\operatorname{segments}\\left[3\\right]', index(member('P_1', 'segments'), 3)],
        ['\\pm=\\left[-1,1\\right]', eq('pm', list(neg(1), 1))],
        ['\\pm\\frac{\\pi}{4}', imp('pm', div('pi', 4))],
        ['20\\ 000', num(20000)],
        ['1\\ 234\\ 567.5', num('1234567.5')],
    ]);
});

describe('the other spellings Desmos accepts for a function', () => {
    cases([
        ['\\operatorname{ittest}\\left(a,b\\right)', call('ttest', 'a', 'b')],
        ['\\operatorname{arsinh}\\left(x\\right)', call('arcsinh', 'x')],
        ['\\operatorname{arcoth}\\left(x\\right)', call('arccoth', 'x')],
        ['\\operatorname{inverseCdf}\\left(L,p\\right)', call('quantile', 'L', 'p')],
        ['\\operatorname{inversecdf}\\left(L,p\\right)', call('quantile', 'L', 'p')],
        ['\\operatorname{TScore}\\left(L,m\\right)', call('tscore', 'L', 'm')],
        ['\\arg\\left(z\\right)', call('arg', 'z')],
        ['\\operatorname{arg}\\left(z\\right)', call('arg', 'z')],
    ]);
});

describe("a statement's =", () => {
    // Read as a row of the expression list, where the `=` takes everything
    // after it - which is where this differs from `parseLatex`.
    const table: [string, Expression][] = [
        [
            'g_{ap}=a-b\\operatorname{with}a=2,b=1',
            eq('gap', withB(sub('a', 'b'), ['a', 2], ['b', 1])),
        ],
        [
            'f\\left(x\\right)=xn\\operatorname{with}n=3',
            eq(call('f', 'x'), withB(imp('x', 'n'), ['n', 3])),
        ],
        ['g=\\left(a\\operatorname{with}a=2\\right)', eq('g', paren(withB('a', ['a', 2])))],
        ['A=a\\to1,b\\to2', eq('A', seq(act('a', 1), act('b', 2)))],
        ['y=2x+1', eq('y', add(imp(2, 'x'), 1))],
        ['a\\operatorname{with}a=5', withB('a', ['a', 5])],
        ['x^{2}+y^{2}<4', cmp(add(pow('x', 2), pow('y', 2)), '<', 4)],
        ['\\left|x\\right|+1', add(abs('x'), 1)],
    ];
    for (const [latex, tree] of table) {
        test(`${latex} → ${show(tree)}`, () => {
            assert.deepEqual(shape(parseLatexStatement(latex), true), shape(tree, true));
        });
    }

    test('reads the same as an expression where there is no `with` to bind', () => {
        for (const latex of ['y=x', 'x=1', '0<y<x', 'y=x^{2}', 'A=a\\to1']) {
            assert.deepEqual(shape(parseLatexStatement(latex)), shape(parseLatex(latex)));
        }
    });
});

describe('calculus, as Desmos writes it', () => {
    cases([
        ['\\sum_{n=1}^{10}n^{2}', sum('n', 1, 10, pow('n', 2))],
        ['\\sum_{n=1}^{3}n+1', add(sum('n', 1, 3, 'n'), 1)],
        ['\\sum_{n=1}^{3}n\\cdot2', sum('n', 1, 3, mul('n', 2))],
        ['2\\sum_{n=1}^{3}n', imp(2, sum('n', 1, 3, 'n'))],
        ['\\prod_{k=1}^{n}k', prod('k', 1, 'n', 'k')],
        ['\\sum_{\\theta=0}^{2}\\theta', sum('theta', 0, 2, 'theta')],
        ['\\int_{0}^{1}t^{2}dt', integral('t', 0, 1, pow('t', 2))],
        ['\\int_0^1t\\ dt', integral('t', 0, 1, 't')],
        [
            '\\int_{0}^{1}\\int_{0}^{1}ts\\ ds\\ dt',
            integral('t', 0, 1, integral('s', 0, 1, imp('t', 's'))),
        ],
        ['\\int_{0}^{1}tdt\\cdot3', mul(integral('t', 0, 1, 't'), 3)],
        ['\\int_{0}^{1}\\frac{d}{dt}t^{2}dt', integral('t', 0, 1, deriv('t', pow('t', 2)))],
        ['\\frac{d}{dx}x^{2}+1', add(deriv('x', pow('x', 2)), 1)],
        ['\\frac{d}{dx}3x\\cdot x', deriv('x', mul(imp(3, 'x'), 'x'))],
        ['\\frac{d}{d\\theta}\\theta', deriv('theta', 'theta')],
        ['\\frac{d}{dx_{1}}x_{1}', deriv('x_1', 'x_1')],
        // Not a derivative: a fraction that happens to have a d in it.
        ['\\frac{d}{2}', div('d', 2)],
        ['\\frac{d}{dx+1}', div('d', add(imp('d', 'x'), 1))],
        ["f'\\left(x\\right)", prime('f', 1, 'x')],
        ["f''\\left(3\\right)", prime('f', 2, 3)],
        ["\\sin'\\left(x\\right)", prime('sin', 1, 'x')],
        ['\\log_{2}\\left(8\\right)', call('log', 8, 2)],
        ['\\log_28', call('log', 8, 2)],
        ['\\log_{b}x', call('log', 'x', 'b')],
    ]);
});

describe('spans', () => {
    test('are offsets into the latex', () => {
        const tree = parseLatex('a+bc');
        assert.deepEqual(tree.span, { start: 0, end: 4 });
        assert.ok(tree.kind === 'Binary');
        assert.deepEqual(tree.left.span, { start: 0, end: 1 });
        assert.deepEqual(tree.right.span, { start: 2, end: 4 });
    });

    test('cover a command and its arguments', () => {
        const tree = parseLatex('1+\\frac{a}{b}');
        assert.ok(tree.kind === 'Binary');
        assert.deepEqual(tree.right.span, { start: 2, end: 13 });
    });
});

describe('latex it has no reading for', () => {
    const unreadable = [
        'a\\&b',
        '\\int_{0}^{1}x',
        '\\sum_{n}^{10}n',
        "f'",
        '\\lfloor x\\rfloor',
        '\\left(x',
        'x\\right)',
        '\\frac{a}',
        'a+',
        '\\operatorname{with}',
        'x_{\\alpha}',
    ];

    for (const latex of unreadable) {
        test(latex, () => {
            assert.throws(() => parseLatex(latex), LatexParseError);
        });
    }

    test('says where the trouble is', () => {
        assert.throws(
            () => parseLatex('1+\\lfloor x\\rfloor'),
            (error: unknown) => error instanceof LatexParseError && error.offset === 2,
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The round trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `tree` as its latex reads back, for comparing with what the parser makes of
 * that latex. Three things change, all of them spellings of one meaning:
 *
 *   - **`Paren` goes.** The emitter adds brackets precedence needs and drops
 *     the author's where braces group already (an exponent, a fraction), so a
 *     bracket is not something the round trip can keep. `shape` removes them.
 *   - **A juxtaposition the emitter had to write with `\cdot` is a `*`.** `2`
 *     beside `3` is 23 to Desmos, `2` beside a fraction is a mixed number, and
 *     anything beside a list indexes it - so those are written `\cdot`, and a
 *     `\cdot` reads back as `*`.
 *   - Spans, which the tree built by hand does not have. `shape` again.
 */
function normalise(tree: Expression): unknown {
    return shape(explicitProducts(tree));
}

/** The kinds the emitter brackets on the left of a product, and so end in `\right)`. */
function bracketedAsFactor(tree: Expression): boolean {
    switch (tree.kind) {
        case 'With':
        case 'For':
        case 'Sequence':
        case 'Action':
        case 'ListRange':
        case 'Comparison':
            return true;
        case 'Binary':
            return tree.operator === '+' || tree.operator === '-' || opensRight(tree);
        case 'Unary':
        case 'BigOperator':
        case 'Derivative':
            return opensRight(tree);
    }
    return false;
}

/** A sum, a product, an integral or a `d/dx` at the right-hand end, which takes the factors after it. */
function opensRight(tree: Expression): boolean {
    switch (tree.kind) {
        case 'BigOperator':
        case 'Derivative':
            return true;
        case 'Unary':
            return opensRight(tree.operand);
        case 'Binary':
            return tree.operator !== '^' && tree.operator !== '/' && opensRight(tree.right);
    }
    return false;
}

function explicitProducts(tree: Expression): Expression {
    const mapped = Object.fromEntries(
        Object.entries(tree).map(([key, value]) => [key, mapChildren(value)]),
    ) as unknown as Expression;

    if (mapped.kind !== 'Binary' || mapped.operator !== 'implicit') {
        return mapped;
    }

    // Read off the original operands, which are what the emitter saw.
    const { left, right } = tree as Expression & { kind: 'Binary' };
    const leftLatex = bracketedAsFactor(left) ? '\\right)' : emitLatex(left);
    const rightLatex = emitLatex(right);
    const dotted =
        /^[0-9.]/.test(rightLatex) ||
        rightLatex.startsWith('\\left[') ||
        (/[0-9.]$/.test(leftLatex) && rightLatex.startsWith('\\frac'));

    return dotted ? { ...mapped, operator: '*' } : mapped;
}

function mapChildren(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(mapChildren);
    }
    if (value && typeof value === 'object' && 'kind' in value) {
        const record = value as { kind: string };
        // Bindings, branches and identifiers hold expressions without being one.
        if (['Binding', 'PiecewiseBranch'].includes(record.kind)) {
            return Object.fromEntries(
                Object.entries(record).map(([key, child]) => [key, mapChildren(child)]),
            );
        }
        return explicitProducts(value as Expression);
    }
    return value;
}

describe('round trip', () => {
    const hand: Expression[] = [
        imp(div(1, 2), 'x'),
        div('a', pow('b', 2)),
        div(pow('x', 2), 3),
        div(div('a', 'b'), 'c'),
        neg(pow('x', 2)),
        pow(2, neg(1)),
        pow(2, pow(3, 2)),
        pow(pow(2, 3), 2),
        imp(2, 'pi', 'x'),
        imp(3, call('cos', 't')),
        imp(2, 3),
        imp(2, div(1, 2)),
        imp('a', list(1, 2)),
        mul('a', neg('b')),
        sub(1, neg(2)),
        eq('A', seq(act('a', 1), act('b', 2))),
        withB(eq(call('f', 'x'), imp('x', 'n')), ['n', 3]),
        eq('L', list(forB(pow('i', 2), ['i', list(range(1, 10))]))),
        piecewise([[cmp('x', '<', 0), neg('x')]], 'x'),
        piecewise([
            [cmp('x', '>', 0), null],
            [cmp('x', '<', 2), null],
        ]),
        member(index('L', range(2, 5)), 'count'),
        fact(add('n', 1)),
        abs(sub(abs('x'), 1)),
        call('nthroot', add('x', 1), 3),
        mul(sum('n', 1, 3, 'n'), 2),
        imp(integral('t', 0, 1, 't'), 'x'),
        add(deriv('x', pow('x', 2)), 1),
        prime('f', 2, 'x'),
        call('log', 'x', 2),
    ];

    for (const tree of hand) {
        test(show(tree), () => {
            const latex = emitLatex(tree);
            assert.deepEqual(normalise(parseLatex(latex)), normalise(tree), latex);
            assert.equal(emitLatex(parseLatex(latex)), latex);
        });
    }

    const TREES = 3000;

    test(`holds over ${TREES} random trees`, () => {
        for (let seed = 1; seed <= TREES; seed++) {
            const tree = expression(seeded(seed));
            const latex = emitLatex(tree);

            let read: Expression;
            try {
                read = parseLatex(latex);
            } catch (error) {
                assert.fail(`seed ${seed}: ${show(tree)}\n  ${latex}\n  ${String(error)}`);
            }

            assert.deepEqual(
                normalise(read),
                normalise(tree),
                `seed ${seed}: ${show(tree)}\n  ${latex}\n  read as ${show(read)}`,
            );
            // And what was read writes the same latex: nothing the emitter
            // chose survives only by accident of the tree it started from.
            assert.equal(emitLatex(read), latex, `seed ${seed}: ${show(tree)}`);
        }
    });
});
