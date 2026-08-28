// ═════════════════════════════════════════════════════════════════════════════
// The language surface, checked against the calculator that has to accept it
// ═════════════════════════════════════════════════════════════════════════════
//
// Every function and constant Axis offers completions for is a promise that
// Desmos knows it. The manifest is hand-written, so the promise is only as good
// as somebody's memory until a calculator is asked — and a name that is one
// letter off compiles perfectly happily into `s_{tdevp}(L)`, an undefined
// function that Desmos reports as nothing at all rather than as an error.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_MANIFEST } from '@axis-dsl/language';
import { convertToLatex } from '@axis-dsl/compiler';
import { skip, useCalculator } from './support.mts';
import type { InspectedExpression } from '../dist/index.js';

/**
 * A call for each function, with arguments of the kind it takes. Desmos reports
 * a wrong *name* and wrong *arguments* the same way, so the arguments have to
 * be right for the name to be what is under test.
 */
const CALLS: Record<string, string> = {
    // trig — an angle in radians, and inverses given something in their domain
    sin: 'sin(0.5)',
    cos: 'cos(0.5)',
    tan: 'tan(0.5)',
    csc: 'csc(0.5)',
    sec: 'sec(0.5)',
    cot: 'cot(0.5)',
    arcsin: 'arcsin(0.5)',
    arccos: 'arccos(0.5)',
    arctan: 'arctan(0.5)',
    arccsc: 'arccsc(2)',
    arcsec: 'arcsec(2)',
    arccot: 'arccot(0.5)',
    sinh: 'sinh(0.5)',
    cosh: 'cosh(0.5)',
    tanh: 'tanh(0.5)',
    csch: 'csch(0.5)',
    sech: 'sech(0.5)',
    coth: 'coth(0.5)',

    // math
    sqrt: 'sqrt(4)',
    nthroot: 'nthroot(8, 3)',
    abs: 'abs(-3)',
    ln: 'ln(2)',
    log: 'log(100)',
    exp: 'exp(1)',
    floor: 'floor(1.7)',
    ceil: 'ceil(1.2)',
    round: 'round(1.5)',
    sign: 'sign(-2)',
    mod: 'mod(7, 3)',
    gcd: 'gcd(4, 6)',
    lcm: 'lcm(4, 6)',

    // statistics — over a list
    total: 'total([1, 2, 3])',
    length: 'length([1, 2, 3])',
    mean: 'mean([1, 2, 3])',
    median: 'median([1, 2, 3])',
    min: 'min([1, 2, 3])',
    max: 'max([1, 2, 3])',
    stdev: 'stdev([1, 2, 3])',
    stdevp: 'stdevp([1, 2, 3])',
    mad: 'mad([1, 2, 3])',
    var: 'var([1, 2, 3])',
    varp: 'varp([1, 2, 3])',
    discretedist: 'discretedist([1, 2, 3], [0.2, 0.3, 0.5])',

    // lists
    repeat: 'repeat(3, 5)',
    join: 'join([1, 2], [3, 4])',
    sort: 'sort([3, 1, 2])',

    // geometry — points, not numbers
    polygon: 'polygon((0, 0), (1, 0), (1, 1))',
    distance: 'distance((0, 0), (3, 4))',
    midpoint: 'midpoint((0, 0), (2, 2))',

    // color
    rgb: 'rgb(255, 0, 0)',
    hsv: 'hsv(0, 1, 1)',
    okhsv: 'okhsv(0, 1, 1)',
    oklab: 'oklab(0.5, 0, 0)',
    oklch: 'oklch(0.5, 0.1, 30)',

    // combinatorics
    nCr: 'nCr(5, 2)',
    nPr: 'nPr(5, 2)',
    factorial: 'factorial(5)',
};

/**
 * The constants that stand for a value. Everything else in the manifest's greek
 * list is a *name* — Desmos has no more opinion about ω than about `a`, and
 * what is being promised there is that the letter survives as the letter.
 */
const VALUE_CONSTANTS: Record<string, number | undefined> = {
    pi: Math.PI,
    tau: 2 * Math.PI,
    e: Math.E,
    infinity: undefined,
};

/**
 * Names Desmos will not let a graph define. θ is its polar angle, the way x and
 * y are its cartesian ones, so `theta = 1` is refused however well the letter
 * itself came through.
 */
const RESERVED_CONSTANTS = new Set(['theta']);

/** The greek letters, which are tested by being defined and used. */
const NAME_CONSTANTS = AXIS_MANIFEST.constants.filter(
    entry =>
        entry.category !== 'boolean' &&
        !(entry.name in VALUE_CONSTANTS) &&
        !RESERVED_CONSTANTS.has(entry.name),
);

describe('every function the language offers', { skip }, () => {
    const calculator = useCalculator();
    let byLatex: Map<string, InspectedExpression>;

    // One graph holding every call, rather than a load each: they do not
    // interact, and 57 loads would be a minute of Chromium for no more signal.
    // The calls are written bare, with nothing assigned to them, because that
    // is the form Desmos reports an unknown name in — see the last test here.
    before(async () => {
        const names = AXIS_MANIFEST.functions.map(entry => entry.name);
        await calculator().load(names.map(name => CALLS[name]).join('\n'));
        const inspected = await calculator().inspectExpressions();
        byLatex = new Map(inspected.map(expression => [expression.latex ?? '', expression]));
    });

    test('every function in the manifest has a call to test it with', () => {
        const missing = AXIS_MANIFEST.functions
            .map(entry => entry.name)
            .filter(name => !CALLS[name]);

        assert.deepEqual(missing, []);
    });

    for (const { name } of AXIS_MANIFEST.functions) {
        test(`${name} is a function Desmos knows`, () => {
            const latex = convertToLatex(CALLS[name]);
            const expression = byLatex.get(latex);
            assert.ok(expression, `${name} compiled to ${latex}, which is not in the graph`);

            assert.equal(
                expression.analysis?.isError,
                false,
                `Desmos rejected ${latex}: ${expression.analysis?.errorMessage}`,
            );
        });
    }

    test('a misspelt function is an error rather than a silent variable', async () => {
        // The failure mode these tests exist to catch. An unknown name compiles
        // to a subscripted variable, so it is only called out when it is asked
        // to stand on its own — which is why the calls above are written bare.
        await calculator().load('notAFunction(1)');
        const [expression] = await calculator().inspectExpressions();

        assert.equal(expression.latex, 'n_{otAFunction}\\left(1\\right)');
        assert.equal(expression.analysis?.isError, true);
    });
});

describe('every constant the language offers', { skip }, () => {
    const calculator = useCalculator();
    let byLatex: Map<string, InspectedExpression>;

    before(async () => {
        await calculator().load(NAME_CONSTANTS.map(entry => `${entry.name} = 1`).join('\n'));
        const inspected = await calculator().inspectExpressions();
        byLatex = new Map(inspected.map(expression => [expression.latex ?? '', expression]));
    });

    for (const { name } of NAME_CONSTANTS) {
        test(`${name} is a name Desmos can define`, () => {
            const latex = convertToLatex(`${name} = 1`);
            const expression = byLatex.get(latex);
            assert.ok(expression, `${name} compiled to ${latex}, which is not in the graph`);

            assert.equal(
                expression.analysis?.isError,
                false,
                `Desmos rejected ${latex}: ${expression.analysis?.errorMessage}`,
            );
            assert.deepEqual(expression.analysis?.evaluation, { type: 'Number', value: 1 });
        });
    }

    test('the greek letters are distinct names, not one letter each', async () => {
        // The compiler turns a multi-letter word into a subscripted variable,
        // so `omega` would be `o_{mega}` if the manifest did not claim it —
        // and `o_{mega}` is a different variable from ω.
        assert.equal(convertToLatex('omega = 1'), '\\omega=1');
        assert.equal(convertToLatex('omeg = 1'), 'o_{meg}=1');

        await calculator().load('omega = 2\nsigma = 3\ny = omega * sigma');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('omega * sigma')).numericValue, 6);
    });

    test('the constants that stand for a value are that value', async () => {
        await calculator().load('a = pi\nb = tau\nc = e\nd = infinity');

        assert.deepEqual(await calculator().getErrors(), []);
        for (const [name, expected] of Object.entries(VALUE_CONSTANTS)) {
            if (expected === undefined) {
                continue;
            }
            const actual = (await calculator().evaluate(name)).numericValue;
            assert.ok(Math.abs(actual - expected) < 1e-9, `${name} came out as ${actual}`);
        }
    });

    test('infinity is Desmos’ infinity', async () => {
        await calculator().load('a = infinity');

        assert.equal(convertToLatex('a = infinity'), 'a=\\infty');
        assert.equal((await calculator().evaluate('a')).numericValue, Infinity);
    });

    test('the boolean constants are for metadata, not for maths', async () => {
        // `true` and `false` are in the manifest so that `# hidden: true`
        // completes; as a value they are just letters, which is the point.
        await calculator().load('y = x # hidden: true');
        const [expression] = await calculator().inspectExpressions();

        assert.equal(expression.analysis?.isError, false);
    });
});

describe('the operators Axis writes for you', { skip }, () => {
    const calculator = useCalculator();

    /** Source, the latex it must compile to, and what it comes out to. */
    const OPERATORS: [string, string, number | undefined][] = [
        // A comparison is its own expression: Desmos will not have one chained
        // onto a definition, so these are written the way a graph would.
        ['y <= 3', 'y\\le3', undefined],
        ['y >= 3', 'y\\ge3', undefined],
        ['a = 2 * 3', 'a=2\\cdot3', 6],
        ['a = 6 / 3', 'a=\\frac{6}{3}', 2],
        ['a = 2 ^ 3', 'a=2^3', 8],
        ['a = |(-3)|', 'a=\\left|\\left(-3\\right)\\right|', 3],
        ['a = nthroot(27, 3)', 'a=\\sqrt[3]{27}', 3],
        ['a = sqrt(16)', 'a=\\sqrt{16}', 4],
    ];

    for (const [source, latex, value] of OPERATORS) {
        test(`${source} compiles and evaluates`, async () => {
            assert.equal(convertToLatex(source), latex);

            await calculator().load(source);
            assert.deepEqual(await calculator().getErrors(), []);

            if (value !== undefined) {
                assert.equal((await calculator().evaluate('a')).numericValue, value);
            }
        });
    }

    test('a coefficient in front of a name does not hide it', async () => {
        // `\\b` does not open a word after a digit, which is what once left
        // `3cos(t)` as three variables multiplied together — a graph Desmos
        // rejects, in three of the example scripts, with nothing to say why.
        assert.equal(convertToLatex('3cos(t)'), '3\\cos\\left(t\\right)');
        assert.equal(convertToLatex('2pi'), '2\\pi');
        assert.equal(convertToLatex('2theta'), '2\\theta');
        assert.equal(convertToLatex('2sqrt(4)'), '2\\sqrt{4}');

        // …while a *letter* in front still makes it one name.
        assert.equal(convertToLatex('xcos(t)'), 'x_{cos}\\left(t\\right)');

        await calculator().load('a = 2pi\nb = 3cos(0)\nc = 2sqrt(9)');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.ok(Math.abs((await calculator().evaluate('a')).numericValue - 2 * Math.PI) < 1e-9);
        assert.equal((await calculator().evaluate('b')).numericValue, 3);
        assert.equal((await calculator().evaluate('c')).numericValue, 6);
    });

    test('a coefficient works inside a piecewise and a parametric too', async () => {
        await calculator().load('y = sin(x) {x > 0, x < 2pi}\n(3cos(t), 2sin(t))');

        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a multi-letter name becomes a subscripted variable Desmos accepts', async () => {
        assert.equal(convertToLatex('amp = 2'), 'a_{mp}=2');

        await calculator().load('amp = 2\ny = amp * x');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('amp')).numericValue, 2);
    });

    test('a piecewise compiles to the braces Desmos wants', async () => {
        assert.equal(convertToLatex('y = {x < 0: -x, x}'), 'y=\\left\\{x<0:-x,x\\right\\}');

        await calculator().load('y = {x < 0: -x, x}');
        const [expression] = await calculator().inspectExpressions();

        assert.equal(expression.analysis?.isGraphable, true);
    });

    test('an action arrow compiles to \\to and drives a slider', async () => {
        assert.equal(convertToLatex('a -> a + 1'), 'a\\to a+1');

        await calculator().load(
            'a = 0 # sliderBounds: {min: 0, max: 5, step: 1}\n(1, 1) # onClick: a -> a + 1, pointSize: 30',
        );
        assert.ok(await calculator().click({ x: 1, y: 1 }));

        assert.equal((await calculator().evaluate('a')).numericValue, 1);
    });

    test('a list and an index both survive the trip', async () => {
        await calculator().load('L = [1...5]\nthird = L[3]');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.deepEqual((await calculator().evaluate('L')).listValue, [1, 2, 3, 4, 5]);
        assert.equal((await calculator().evaluate('third')).numericValue, 3);
    });

    test('list arithmetic maps over every element', async () => {
        await calculator().load('N = [1, 2, 3]\nsquares = N ^ 2');

        assert.deepEqual((await calculator().evaluate('squares')).listValue, [1, 4, 9]);
    });
});
