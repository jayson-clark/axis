// ═════════════════════════════════════════════════════════════════════════════
// The language surface, checked against the calculator that has to accept it
// ═════════════════════════════════════════════════════════════════════════════
//
// Every function, operator and constant Axis offers completions for is a
// promise that Desmos knows it. The manifest is hand-written, so the promise is
// only as good as somebody's memory until a calculator is asked - and a name
// that is one letter off compiles perfectly happily into `s_{tdevp}(L)`, an
// undefined function that Desmos reports as nothing at all rather than as an
// error. The v2 checker catches that one now (`unknown-function`), but only for
// names it knows are not functions; whether the ones it thinks are, are, is
// still Desmos' to say.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_MANIFEST, parseExpression } from '@axis-dsl/syntax';
import { compileAxis, emitLatex } from '@axis-dsl/compiler';
import type { AxisCalculator, InspectedExpression } from '../dist/index.js';
import { skip, useCalculator } from './support.mts';

/** The latex an Axis expression emits, which is what the graph will hold. */
function latexOf(source: string): string {
    const parsed = parseExpression(source);
    assert.deepEqual(parsed.diagnostics, [], `${source} does not parse`);
    return emitLatex(parsed.expression);
}

/** Load `source`, which has to be source the checker has nothing to say about. */
async function loadClean(calculator: AxisCalculator, source: string): Promise<void> {
    const { diagnostics } = await calculator.load(source);
    assert.deepEqual(
        diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`),
        [],
        `${source} is not clean`,
    );
}

/**
 * A call for each function, with arguments of the kind it takes. Desmos reports
 * a wrong *name* and wrong *arguments* the same way, so the arguments have to
 * be right for the name to be what is under test.
 */
const CALLS: Record<string, string> = {
    // trig - an angle in radians, and inverses given something in their domain
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
    arcsinh: 'arcsinh(0.5)',
    arccosh: 'arccosh(2)',
    arctanh: 'arctanh(0.5)',
    arccsch: 'arccsch(0.5)',
    arcsech: 'arcsech(0.5)',
    arccoth: 'arccoth(2)',

    // math
    sqrt: 'sqrt(4)',
    nthroot: 'nthroot(8, 3)',
    abs: 'abs(-3)',
    ln: 'ln(2)',
    log: 'log(100)',
    sum: 'sum(n = 1..3, n)',
    prod: 'prod(n = 1..4, n)',
    int: 'int(t = 0..1, 2t)',
    exp: 'exp(1)',
    floor: 'floor(1.7)',
    ceil: 'ceil(1.2)',
    round: 'round(1.5)',
    sign: 'sign(-2)',
    sgn: 'sgn(-2)',
    mod: 'mod(7, 3)',
    gcd: 'gcd(4, 6)',
    lcm: 'lcm(4, 6)',
    erf: 'erf(1)',

    // statistics - over a list
    total: 'total([1, 2, 3])',
    length: 'length([1, 2, 3])',
    count: 'count([1, 2, 3])',
    mean: 'mean([1, 2, 3])',
    median: 'median([1, 2, 3])',
    min: 'min([1, 2, 3])',
    max: 'max([1, 2, 3])',
    stdev: 'stdev([1, 2, 3])',
    stdevp: 'stdevp([1, 2, 3])',
    mad: 'mad([1, 2, 3])',
    var: 'var([1, 2, 3])',
    varp: 'varp([1, 2, 3])',
    quantile: 'quantile([1, 2, 3, 4], 0.5)',
    quartile: 'quartile([1, 2, 3, 4], 1)',
    cov: 'cov([1, 2, 3], [1, 2, 4])',
    covp: 'covp([1, 2, 3], [1, 2, 4])',
    corr: 'corr([1, 2, 3], [1, 2, 4])',
    spearman: 'spearman([1, 2, 3], [1, 2, 4])',
    tscore: 'tscore([1, 2, 3], 1)',

    // distributions - drawn on their own, evaluated with their members
    normaldist: 'normaldist(0, 1)',
    tdist: 'tdist(3)',
    chisqdist: 'chisqdist(2)',
    uniformdist: 'uniformdist(0, 4)',
    binomialdist: 'binomialdist(10, 0.5)',
    poissondist: 'poissondist(2)',
    geodist: 'geodist(0.5)',
    pdf: 'pdf(normaldist(0, 1), 0)',
    cdf: 'cdf(normaldist(0, 1), 0)',

    // inference - a test has no value of its own, so each is read through a
    // member, and each member is called on a test
    ttest: 'ttest([1, 2, 3, 4, 6]).score',
    ztest: 'ztest([1, 2, 3, 4, 6], 1).score',
    zproptest: 'zproptest(40, 100).score',
    chisqtest: 'chisqtest([10, 20], [30, 25]).score',
    chisqgof: 'chisqgof([10, 20, 30], [20, 20, 20]).score',
    score: 'score(ttest([1, 2, 3, 4, 6]))',
    pleft: 'pleft(ttest([1, 2, 3, 4, 6]))',
    pright: 'pright(ttest([1, 2, 3, 4, 6]))',
    dof: 'dof(ttest([1, 2, 3, 4, 6]))',
    estimate: 'estimate(ttest([1, 2, 3, 4, 6]))',
    stderr: 'stderr(ttest([1, 2, 3, 4, 6]))',
    conf: 'conf(ttest([1, 2, 3, 4, 6]), 0.95).upper',
    null: 'null(ttest([1, 2, 3, 4, 6]), 3).pleft',
    lower: 'lower(ttest([1, 2, 3, 4, 6]).conf(0.95))',
    upper: 'upper(ttest([1, 2, 3, 4, 6]).conf(0.95))',
    discretedist: 'discretedist([1, 2, 3], [0.2, 0.3, 0.5])',
    random: 'random()',

    // lists
    repeat: 'repeat(3, 5)',
    join: 'join([1, 2], [3, 4])',
    sort: 'sort([3, 1, 2])',
    unique: 'unique([1, 2, 2, 3])',
    shuffle: 'shuffle([1, 2, 3])',

    // geometry - points, not numbers
    polygon: 'polygon((0, 0), (1, 0), (1, 1))',
    polygonGlider: 'polygonGlider(polygon((0, 0), (1, 0), (1, 1)), 0.5)',
    polygonInteriorDirectedAngles:
        'polygonInteriorDirectedAngles(polygon((0, 0), (1, 0), (1, 1)), 1)',
    distance: 'distance((0, 0), (3, 4))',
    midpoint: 'midpoint((0, 0), (2, 2))',
    // on the geometry calculator, or the 3D one, where they exist
    segment: 'segment((0, 0), (4, 1))',
    line: 'line((0, 0), (4, 1))',
    ray: 'ray((0, 0), (4, 1))',
    vector: 'vector((0, 0), (4, 1))',
    circle: 'circle((0, 0), 2)',
    arc: 'arc((0, 0), (1, 3), (4, 1))',
    glider: 'glider(circle((0, 0), 2), 0.25)',
    parallel: 'parallel(line((0, 0), (4, 1)), (1, 3))',
    perpendicular: 'perpendicular(line((0, 0), (4, 1)), (1, 3))',
    intersection: 'intersection(circle((0, 0), 2), line((0, 0), (4, 1)))',
    strictintersection: 'strictintersection(circle((0, 0), 2), segment((0, 0), (4, 1)))',
    angle: 'angle((0, 0), (4, 1), (1, 3))',
    directedangle: 'directedangle((0, 0), (4, 1), (1, 3))',
    angles: 'angles(polygon((0, 0), (4, 1), (1, 3)))',
    directedangles: 'directedangles(polygon((0, 0), (4, 1), (1, 3)))',
    anglebisector: 'anglebisector(angle((0, 0), (4, 1), (1, 3)))',
    coterminal: 'coterminal(angle((0, 0), (4, 1), (1, 3)))',
    supplement: 'supplement(directedangle((0, 0), (4, 1), (1, 3)))',
    center: 'center(circle((1, 1), 2))',
    radius: 'radius(circle((1, 1), 2))',
    area: 'area(polygon((0, 0), (4, 0), (0, 3)))',
    perimeter: 'perimeter(polygon((0, 0), (4, 0), (0, 3)))',
    start: 'start(vector((0, 0), (4, 1)))',
    end: 'end(vector((0, 0), (4, 1)))',
    vertices: 'vertices(polygon((0, 0), (4, 1), (1, 3)))',
    segments: 'segments(polygon((0, 0), (4, 1), (1, 3)))',
    translate: 'translate(polygon((0, 0), (4, 1), (1, 3)), (0, 0), (2, 2))',
    rotate: 'rotate(polygon((0, 0), (4, 1), (1, 3)), (0, 0), pi / 2)',
    dilate: 'dilate(polygon((0, 0), (4, 1), (1, 3)), (0, 0), 2)',
    reflect: 'reflect(polygon((0, 0), (4, 1), (1, 3)), line((0, 0), (0, 1)))',
    triangle: 'triangle((0, 0, 0), (1, 0, 0), (0, 1, 1))',
    sphere: 'sphere((0, 0, 0), 2)',

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

    // complex - only in complex mode, which the graph they are drawn in is in
    real: 'real(3 + 4i)',
    imag: 'imag(3 + 4i)',
    conj: 'conj(3 + 4i)',
    arg: 'arg(3 + 4i)',

    // audio - a frequency in hertz and a volume of 0 to 1. Nothing is heard in
    // a headless browser, but Desmos still says whether it knows the name.
    tone: 'tone(440, 0.5)',
};

/**
 * What a handful of the calls come to, so that "Desmos knows the name" is also
 * "Desmos reads the arguments where Axis put them" - `nthroot(8, 3)` is 2, not
 * the cube root of 8's square root or the 8th root of 3.
 */
const VALUES: Record<string, number> = {
    sqrt: 2,
    nthroot: 2,
    abs: 3,
    mod: 1,
    gcd: 2,
    lcm: 12,
    sum: 6,
    prod: 24,
    int: 1,
    total: 6,
    count: 3,
    mean: 2,
    max: 3,
    nCr: 10,
    nPr: 20,
    factorial: 120,
    distance: 5,
    quantile: 2.5,
    quartile: 1.5,
    cov: 1.5,
    covp: 1,
    spearman: 1,
    real: 3,
    imag: 4,
    radius: 2,
    area: 6,
    perimeter: 12,
};

/**
 * The constants that stand for a value. Everything else in the manifest's greek
 * list is a *name* - Desmos has no more opinion about ω than about `a`, and
 * what is being promised there is that the letter survives as the letter.
 */
const VALUE_CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    tau: 2 * Math.PI,
    e: Math.E,
    infinity: Infinity,
};

/**
 * Names Desmos will not let a graph define. θ is its polar angle, the way x and
 * y are its cartesian ones, so `theta = 1` is refused however well the letter
 * itself came through - in a cartesian graph as much as a polar one.
 */
const RESERVED_CONSTANTS = new Set(['theta']);

/** `true` and `false`, which are metadata values and never maths (spec §8). */
const BOOLEAN_CONSTANTS = new Set(['true', 'false']);

/** The greek letters, which are tested by being defined and used. */
const NAME_CONSTANTS = AXIS_MANIFEST.constants.filter(
    entry =>
        !BOOLEAN_CONSTANTS.has(entry.name) &&
        !(entry.name in VALUE_CONSTANTS) &&
        !RESERVED_CONSTANTS.has(entry.name),
);

describe('every function the language offers', { skip }, () => {
    const calculator = useCalculator();
    let inspected: InspectedExpression[];
    const names = AXIS_MANIFEST.functions.map(entry => entry.name);

    // One graph holding every call, rather than a load each: they do not
    // interact, and 70 loads would be a minute of Chromium for no more signal.
    // The calls are written bare, with nothing assigned to them, because that
    // is the form Desmos reports an unknown name in. Each is its own statement,
    // so the list is in the manifest's order. A function that exists only in
    // complex mode, or only on another calculator, has a graph of its own
    // where it does: complex mode turned on for everything makes `sqrt(4)` the
    // complex number 2 + 0i, and the geometry calculator has no `length` of a
    // list.
    before(async () => {
        const where = (name: string): string => {
            const definition = AXIS_MANIFEST.functions.find(entry => entry.name === name);
            if (definition?.complex) return 'config { allowComplex: true }';
            const calculator = definition?.calculators?.[0];
            return calculator ? `config { calculator: ${calculator} }` : '';
        };
        const graphs = new Map<string, string[]>();
        for (const name of names) {
            graphs.set(where(name), [...(graphs.get(where(name)) ?? []), name]);
        }
        const found = new Map<string, InspectedExpression>();
        for (const [config, members] of graphs) {
            await loadClean(calculator(), [config, ...members.map(name => CALLS[name])].join('\n'));
            const expressions = await calculator().inspectExpressions();
            members.forEach((name, index) => found.set(name, expressions[index]));
        }
        inspected = names.map(name => found.get(name)!);
    });

    test('every function in the manifest has a call to test it with', () => {
        const missing = names.filter(name => !CALLS[name]);

        assert.deepEqual(missing, []);
    });

    names.forEach((name, index) => {
        test(`${name} is a function Desmos knows`, () => {
            const expression = inspected[index];
            assert.equal(expression?.latex, latexOf(CALLS[name]));

            const analysis = expression.analysis;
            assert.equal(
                analysis?.isError,
                false,
                `Desmos rejected ${expression.latex}: ${analysis?.errorMessage}`,
            );
            // Not being an error is not enough: an unknown name is not one
            // either. A call Desmos knows comes to a value or draws something -
            // except a colour or a tone, whose value the analysis does not
            // report; those are proved by use below.
            const category = AXIS_MANIFEST.functions.find(entry => entry.name === name)?.category;
            if (category !== 'color' && category !== 'audio') {
                assert.ok(
                    analysis?.evaluation !== undefined || analysis?.isGraphable,
                    `${expression.latex} neither evaluates nor graphs`,
                );
            }
            if (name in VALUES) {
                assert.deepEqual(analysis?.evaluation, { type: 'Number', value: VALUES[name] });
            }
        });
    });

    test('a misspelt function is an error rather than a silent variable', async () => {
        // The failure mode these tests exist to catch, which the checker now
        // catches first. An unknown name still compiles - to a subscripted
        // variable - and Desmos calls it out only because it stands alone.
        const { diagnostics } = await calculator().load('notAFunction(1)');
        const [expression] = await calculator().inspectExpressions();

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['unknown-function'],
        );
        assert.equal(expression.latex, 'n_{otAFunction}\\left(1\\right)');
        assert.equal(expression.analysis?.isError, true);
    });

    test('a complex-mode function is an error outside complex mode, to Desmos and to Axis', async () => {
        const { diagnostics } = await calculator().load('a = real(3 + 4i)');
        const [expression] = await calculator().inspectExpressions();

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['requires-complex-mode'],
        );
        assert.equal(expression.analysis?.isError, true);
    });

    test('a member called is the function called with the member first', async () => {
        await loadClean(
            calculator(),
            'D = normaldist(0, 1)\np = D.cdf(1)\nq = cdf(D, 1)\nL = [1, 2, 3, 4]\nm = L.quantile(0.5)\nT = ttest([1, 2, 3, 4, 6])\nhi = T.conf(0.95).upper',
        );
        const values = (await calculator().inspectExpressions()).map(
            expression =>
                (expression.analysis?.evaluation as { value?: unknown } | undefined)?.value,
        );

        assert.equal(values[1], 0.8413447460685429);
        assert.equal(values[2], values[1]);
        assert.equal(values[4], 2.5);
        assert.ok(typeof values[6] === 'number' && values[6] > 5.5 && values[6] < 5.6);
    });

    test('a geometry function is an error on the graphing calculator, to Desmos and to Axis', async () => {
        const { diagnostics } = await calculator().load('s = segment((0, 0), (4, 1))');
        const [expression] = await calculator().inspectExpressions();

        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['requires-calculator'],
        );
        assert.equal(expression.analysis?.isError, true);
    });

    test('a geometry token is defined in the hidden folder, where Desmos accepts it', async () => {
        await loadClean(
            calculator(),
            [
                'config { calculator: GEOMETRY }',
                'folder "Mine" {',
                '    $1 = (0, 0)',
                '    $2 = segment($1, (4, 1))',
                '    $3(x) = reflect(x, line((0, 0), (0, 1)))',
                '}',
                'm = $2.length',
                '$3($2)',
            ].join('\n'),
        );
        const state = await calculator().getState();
        const list = state.expressions?.list ?? [];
        const hidden = list.filter(
            item => (item as { folderId?: string }).folderId === '**dcg_geo_folder**',
        );

        // The three definitions, and not the use of one after them.
        assert.deepEqual(
            hidden.map(item => (item as { latex?: string }).latex),
            [
                '\\token{1}=\\left(0,0\\right)',
                '\\token{2}=\\operatorname{segment}\\left(\\token{1},\\left(4,1\\right)\\right)',
                '\\token{3}\\left(x\\right)=\\operatorname{reflect}\\left(x,\\operatorname{line}\\left(\\left(0,0\\right),\\left(0,1\\right)\\right)\\right)',
            ],
        );
        assert.deepEqual(await calculator().getErrors(), []);
        const length = (await calculator().inspectExpressions()).find(
            expression => expression.latex === 'm=\\token{2}.\\operatorname{length}',
        );
        assert.equal((length?.analysis?.evaluation as { value: number }).value, Math.hypot(4, 1));
    });

    test('every colour function colours a curve', async () => {
        const colours = AXIS_MANIFEST.functions.filter(entry => entry.category === 'color');
        await loadClean(
            calculator(),
            colours.map(entry => `y = x @ color: ${CALLS[entry.name]}`).join('\n'),
        );
        const curves = await calculator().inspectExpressions();

        assert.equal(curves.length, colours.length);
        for (const curve of curves) {
            assert.equal(curve.analysis?.isGraphable, true, String(curve.latex));
        }
        assert.deepEqual(await calculator().getErrors(), []);
    });

    test('a function is also written postfix, as a member', async () => {
        // Spec §5.4: any single-argument function in the manifest.
        await loadClean(calculator(), 'L = [3, 1, 2]\na = L.max\nb = L.count\nc = L.sort');

        assert.equal((await calculator().evaluate('a')).numericValue, 3);
        assert.equal((await calculator().evaluate('b')).numericValue, 3);
        assert.deepEqual((await calculator().evaluate('c')).listValue, [1, 2, 3]);
    });
});

describe('every constant the language offers', { skip }, () => {
    const calculator = useCalculator();
    let inspected: InspectedExpression[];

    before(async () => {
        await loadClean(calculator(), NAME_CONSTANTS.map(entry => `${entry.name} = 1`).join('\n'));
        inspected = await calculator().inspectExpressions();
    });

    test('every constant in the manifest is tested one way or another', () => {
        const covered = new Set([
            ...NAME_CONSTANTS.map(entry => entry.name),
            ...Object.keys(VALUE_CONSTANTS),
            ...RESERVED_CONSTANTS,
            ...BOOLEAN_CONSTANTS,
        ]);
        const missing = AXIS_MANIFEST.constants
            .map(entry => entry.name)
            .filter(name => !covered.has(name));

        assert.deepEqual(missing, []);
    });

    NAME_CONSTANTS.forEach(({ name }, index) => {
        test(`${name} is a name Desmos can define`, () => {
            const expression = inspected[index];
            assert.equal(expression?.latex, latexOf(`${name} = 1`));

            assert.equal(
                expression.analysis?.isError,
                false,
                `Desmos rejected ${expression.latex}: ${expression.analysis?.errorMessage}`,
            );
            assert.deepEqual(expression.analysis?.evaluation, { type: 'Number', value: 1 });
        });
    });

    test('the greek letters are distinct names, not one letter each', async () => {
        // The compiler turns a multi-letter word into a subscripted variable,
        // so `omega` would be `o_{mega}` if the manifest did not claim it -
        // and `o_{mega}` is a different variable from ω.
        assert.equal(latexOf('omega = 1'), '\\omega=1');
        assert.equal(latexOf('omeg = 1'), 'o_{meg}=1');

        await loadClean(calculator(), 'omega = 2\nsigma = 3\ny = omega * sigma');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('omega * sigma')).numericValue, 6);
    });

    for (const [name, expected] of Object.entries(VALUE_CONSTANTS)) {
        test(`${name} is the value it stands for`, async () => {
            await loadClean(calculator(), `a = ${name}`);

            const actual = (await calculator().evaluate('a')).numericValue;
            assert.ok(
                actual === expected || Math.abs(actual - expected) < 1e-9,
                `${name} came out as ${actual}`,
            );
        });
    }

    test('a value constant cannot be redefined', () => {
        for (const name of Object.keys(VALUE_CONSTANTS)) {
            assert.deepEqual(
                compileAxis(`${name} = 1`).diagnostics.map(diagnostic => diagnostic.code),
                ['assign-to-builtin'],
                name,
            );
        }
    });

    test('theta is the polar angle, and Desmos will not have it defined', async () => {
        await loadClean(calculator(), 'config { polarMode: true }\nr = theta');
        assert.deepEqual(await calculator().getErrors(), []);

        await calculator().load('theta = 1');
        const [error] = await calculator().getErrors();
        assert.equal(error?.latex, '\\theta=1');
    });

    test('the boolean constants are for metadata, not for maths', async () => {
        // `true` and `false` are in the manifest so that `@ hidden: true`
        // completes; in an expression Desmos has no booleans, and the checker
        // says so rather than letting `true` through as t·r·u·e.
        await loadClean(calculator(), 'y = x @ hidden: true, lines: false');
        const [expression] = await calculator().inspectExpressions();
        assert.equal(expression.analysis?.isGraphable, true);

        for (const name of BOOLEAN_CONSTANTS) {
            assert.deepEqual(
                compileAxis(`a = ${name}`).diagnostics.map(diagnostic => diagnostic.code),
                ['boolean-in-expression'],
                name,
            );
        }
    });
});

/**
 * A use of each bare operator - the words Desmos writes as `\operatorname{…}`
 * without a call to hold them - and what it has to come to. Each is asserted
 * on its value rather than on not being an error: a name Desmos does not know
 * is an undefined variable, which is no error at all.
 */
const OPERATOR_USES: Record<string, (calculator: AxisCalculator) => Promise<void>> = {
    width: async calculator => {
        await loadClean(calculator, 'a = width');
        const width = (await calculator.evaluate('a')).numericValue;
        assert.ok(width > 0 && Number.isFinite(width), `width came out as ${width}`);
    },
    height: async calculator => {
        await loadClean(calculator, 'a = height');
        const height = (await calculator.evaluate('a')).numericValue;
        assert.ok(height > 0 && Number.isFinite(height), `height came out as ${height}`);
    },
    for: async calculator => {
        await loadClean(calculator, 'S = [i ^ 2 for i = [1...10]]');
        assert.equal((await calculator.evaluate('length(S)')).numericValue, 10);
        assert.equal((await calculator.evaluate('total(S)')).numericValue, 385);
    },
    with: async calculator => {
        await loadClean(calculator, 'a = n ^ 2 with n = 3');
        assert.equal((await calculator.evaluate('a')).numericValue, 9);
    },
    // `index` only exists where Desmos is walking a list one element at a
    // time, which is a clickable action on a list of points - so the second
    // point is clicked, and the action writes 2.
    index: async calculator => {
        await loadClean(
            calculator,
            'n = 0\nP = [(1, 1), (2, 2)] @ onClick: n -> index, pointSize: 30',
        );
        assert.ok(await calculator.click({ x: 2, y: 2 }), 'the point was off screen');
        assert.equal((await calculator.evaluate('n')).numericValue, 2);
    },
    // `dt` exists only in a ticker's handler, where it is the milliseconds
    // since the last tick - so a counter adding it up passes the time.
    dt: async calculator => {
        await loadClean(calculator, 'n = 0\nticker n -> n + dt @ minStep: 20, playing');
        await calculator.settle(400);
        const elapsed = (await calculator.evaluate('n')).numericValue;
        assert.ok(elapsed > 100, `n added up only ${elapsed}ms of ticks`);
    },
};

describe('every bare operator the language offers', { skip }, () => {
    const calculator = useCalculator();

    test('every operator in the manifest has a use to test it with', () => {
        const missing = AXIS_MANIFEST.operators
            .map(entry => entry.name)
            .filter(name => !OPERATOR_USES[name]);

        assert.deepEqual(missing, []);
    });

    for (const { name } of AXIS_MANIFEST.operators) {
        test(`${name} is a word Desmos knows`, async () => {
            await OPERATOR_USES[name](calculator());
            assert.deepEqual(await calculator().getErrors(), []);
        });
    }

    test('width and height read the viewport, not two variables', () => {
        // Left to the subscript rule these would be `w_{idth}` and `h_{eight}`,
        // undefined variables Desmos reports nothing at all about.
        assert.equal(latexOf('width'), '\\operatorname{width}');
        assert.equal(latexOf('height'), '\\operatorname{height}');
    });

    test('with names a value for the expression in front of it', () => {
        assert.equal(latexOf('n ^ 2 with n = 3'), 'n^{2}\\operatorname{with}n=3');
    });

    test('a name that merely opens with an operator is still a variable', async () => {
        assert.equal(latexOf('heightMap = 2'), 'h_{eightMap}=2');

        await loadClean(calculator(), 'heightMap = 2\ny = heightMap * x');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('heightMap')).numericValue, 2);
    });

    test('dt anywhere but a ticker is an error', () => {
        assert.deepEqual(
            compileAxis('a = dt').diagnostics.map(diagnostic => diagnostic.code),
            ['dt-outside-ticker'],
        );
    });

    test('random draws a number rather than naming a variable', async () => {
        assert.equal(latexOf('random()'), '\\operatorname{random}\\left(\\right)');

        await loadClean(calculator(), 'a = random()\nR = random(5)');

        const drawn = (await calculator().evaluate('a')).numericValue;
        assert.ok(drawn >= 0 && drawn < 1, `random() came out as ${drawn}`);
        assert.equal((await calculator().evaluate('length(R)')).numericValue, 5);
    });
});

describe('the operators Axis writes for you', { skip }, () => {
    const calculator = useCalculator();

    /** Source, the latex it must compile to, and what it comes out to. */
    const OPERATORS: [string, string, number | undefined][] = [
        ['y <= 3', 'y\\le3', undefined],
        ['y >= 3', 'y\\ge3', undefined],
        ['a = 2 * 3', 'a=2\\cdot3', 6],
        ['a = 6 / 3', 'a=\\frac{6}{3}', 2],
        ['a = 2 ^ 3', 'a=2^{3}', 8],
        ['a = 2 ^ 10', 'a=2^{10}', 1024],
        ['a = |(-3)|', 'a=\\left|\\left(-3\\right)\\right|', 3],
        ['a = nthroot(27, 3)', 'a=\\sqrt[3]{27}', 3],
        ['a = sqrt(16)', 'a=\\sqrt{16}', 4],
        ['a = 5!', 'a=5!', 120],
    ];

    for (const [source, latex, value] of OPERATORS) {
        test(`${source} compiles and evaluates`, async () => {
            assert.equal(latexOf(source), latex);

            await loadClean(calculator(), source);
            const [expression] = await calculator().inspectExpressions();
            assert.equal(expression.analysis?.isError, false);

            if (value === undefined) {
                assert.equal(expression.analysis?.isGraphable, true);
            } else {
                assert.equal((await calculator().evaluate('a')).numericValue, value);
            }
        });
    }

    test('a coefficient in front of a name does not hide it', async () => {
        // `3cos(t)` once compiled to three variables multiplied together - a
        // graph Desmos rejects, in three of the example files, with nothing
        // to say why. Juxtaposition is multiplication (spec §5.1).
        assert.equal(latexOf('3cos(t)'), '3\\cos\\left(t\\right)');
        assert.equal(latexOf('2pi'), '2\\pi');
        assert.equal(latexOf('2theta'), '2\\theta');
        assert.equal(latexOf('2sqrt(4)'), '2\\sqrt{4}');

        await loadClean(calculator(), 'a = 2pi\nb = 3cos(0)\nc = 2sqrt(9)');

        assert.ok(Math.abs((await calculator().evaluate('a')).numericValue - 2 * Math.PI) < 1e-9);
        assert.equal((await calculator().evaluate('b')).numericValue, 3);
        assert.equal((await calculator().evaluate('c')).numericValue, 6);
    });

    test('while a letter in front makes one longer name, which is no function', () => {
        assert.deepEqual(
            compileAxis('y = xcos(t)').diagnostics.map(diagnostic => diagnostic.code),
            ['unknown-function'],
        );
    });

    test('a single letter in front of a bracket is a product, not a call', async () => {
        // Spec §5.3: `k(x - 1)` is k·(x - 1), since `k` is no function.
        await loadClean(calculator(), 'k = 3\na = k(2 - 1)');

        assert.equal((await calculator().evaluate('a')).numericValue, 3);
    });

    test('a coefficient works inside a piecewise and a parametric too', async () => {
        await loadClean(calculator(), 'y = sin(x) {x > 0, x < 2pi}\n(3cos(t), 2sin(t))');

        const expressions = await calculator().inspectExpressions();
        assert.ok(expressions.every(expression => expression.analysis?.isGraphable));
    });

    test('a multi-letter name becomes a subscripted variable Desmos accepts', async () => {
        assert.equal(latexOf('amp = 2'), 'a_{mp}=2');

        await loadClean(calculator(), 'amp = 2\ny = amp * x');

        assert.equal((await calculator().evaluate('amp')).numericValue, 2);
    });

    test('a piecewise compiles to the braces Desmos wants', async () => {
        assert.equal(latexOf('y = {x < 0: -x, x}'), 'y=\\left\\{x<0:-x,x\\right\\}');

        await loadClean(calculator(), 'y = {x < 0: -x, x}');
        const [expression] = await calculator().inspectExpressions();

        assert.equal(expression.analysis?.isGraphable, true);
    });

    test('an action arrow compiles to \\to and drives a slider', async () => {
        assert.equal(latexOf('a -> a + 1'), 'a\\to a+1');

        await loadClean(
            calculator(),
            'a = 0 @ slider: 0..5 step 1\n(1, 1) @ onClick: a -> a + 1, pointSize: 30',
        );
        assert.ok(await calculator().click({ x: 1, y: 1 }));

        assert.equal((await calculator().evaluate('a')).numericValue, 1);
    });

    test('a list and an index both survive the trip', async () => {
        await loadClean(calculator(), 'L = [1...5]\nthird = L[3]');

        assert.deepEqual((await calculator().evaluate('L')).listValue, [1, 2, 3, 4, 5]);
        assert.equal((await calculator().evaluate('third')).numericValue, 3);
    });

    test("Desmos' own spelling of a list range is the same range", async () => {
        await loadClean(calculator(), 'L = [1, ..., 5]\nM = [1, 3...9]');

        assert.deepEqual((await calculator().evaluate('L')).listValue, [1, 2, 3, 4, 5]);
        assert.deepEqual((await calculator().evaluate('M')).listValue, [1, 3, 5, 7, 9]);
    });

    test('list arithmetic maps over every element', async () => {
        await loadClean(calculator(), 'N = [1, 2, 3]\nsquares = N ^ 2');

        assert.deepEqual((await calculator().evaluate('squares')).listValue, [1, 4, 9]);
    });

    test('a point has coordinates to read', async () => {
        await loadClean(calculator(), 'P = (3, 4)\na = P.x + P.y');

        assert.equal((await calculator().evaluate('a')).numericValue, 7);
    });
});
