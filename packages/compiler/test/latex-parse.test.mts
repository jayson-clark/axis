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
import { emitLatex, LatexParseError, parseLatex } from '../dist/index.js';
import {
    abs,
    act,
    add,
    call,
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
    mul,
    neg,
    paren,
    piecewise,
    pow,
    range,
    seq,
    shape,
    show,
    sub,
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
            // An unbraced script is one character, as in TeX: x²·3.
            ['x^23', imp(pow('x', 2), 3)],
            ['x^n', pow('x', 'n')],
            ['2^{-1}', pow(2, neg(1))],
            ['e^{\\pi}', pow('e', 'pi')],
            ['x^\\pi', pow('x', 'pi')],
            ['2^{3^{2}}', pow(2, pow(3, 2))],
            ['x^{\\left(n-1\\right)}', pow('x', paren(sub('n', 1)))],
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
            ['s_{tep}\\left(x\\right)', call('step', 'x')],
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
        '\\sum_{n=0}^{10}n',
        '\\int_{0}^{1}xdx',
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
            () => parseLatex('1+\\sum_{n=0}^{2}n'),
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
            return tree.operator === '+' || tree.operator === '-';
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
