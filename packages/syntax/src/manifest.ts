// ═════════════════════════════════════════════════════════════════════════════
// The Axis language manifest
// ═════════════════════════════════════════════════════════════════════════════
//
// Every name the language knows - its functions, constants, metadata properties
// and calculator settings - is declared once here. Completions, the checker, the
// grammar and the compiler's LaTeX mapping all read from it, so adding a
// function is a single edit.
//
// Every property says what its value must be (`valueType`) and where it may be
// written (`appliesTo`), which is everything the checker needs to reject
// `color: red` or `collapsed` on a point without a rule of its own for either.
//
// Every function, operator and property also carries an `example`, and any of
// them may carry `documentation` beyond its one-line `detail`: hover shows both,
// and the reference on the docs site is generated from nothing else. An example
// is a whole file, read as though it sat in `examples/` - so it may
// import `./lib/waves` or draw `./images/wave.png` - and the tests compile every
// one and load it on a real calculator, so the reference cannot show code that
// does not work.
//
// The lookups below are derived once at module load: the compiler consults them
// per expression, which on a live preview means per keystroke.

import { KEYWORDS } from './tokens';

/** A built-in function, as offered in completions and emitted as LaTeX. */
export interface FunctionDefinition {
    name: string;
    detail: string;
    /** Markdown beyond {@link detail}, for hover and the reference. */
    documentation?: string;
    /** A short file that uses it (see the head of this file). */
    example: string;
    snippet?: string;
    category:
        | 'trig'
        | 'math'
        | 'list'
        | 'color'
        | 'statistics'
        | 'combinatorics'
        | 'complex'
        | 'geometry'
        | 'audio';
    /**
     * Whether Desmos knows it only in complex mode. Anywhere else it is an
     * error on the calculator, so the checker reports it first.
     */
    complex?: true;
    /**
     * LaTeX command Desmos expects for this function. Only names that are real
     * LaTeX commands set this; everything else falls back to
     * `\operatorname{name}`, which is what Desmos emits for multi-letter
     * functions.
     */
    latex?: string;
}

/**
 * A bare word Desmos writes as `\operatorname{…}` without taking a call.
 *
 * `width` and `height` read the viewport; `for` joins a list comprehension to
 * the variable it runs over; `with` names a value for the expression in front
 * of it. None of them is a function - there are no parentheses to write - and
 * none is a constant, because a constant that opens a longer name carries the
 * rest as a subscript, and `heightMap` is a variable somebody named rather than
 * the viewport height subscripted by `Map`.
 */
export interface OperatorDefinition {
    name: string;
    detail: string;
    /** Markdown beyond {@link detail}, for hover and the reference. */
    documentation?: string;
    /** A short file that uses it (see the head of this file). */
    example: string;
    category: 'viewport' | 'list' | 'scope' | 'ticker';
}

/** A built-in constant: a Greek letter, a mathematical constant, a boolean. */
export interface ConstantDefinition {
    name: string;
    detail: string;
    /** Markdown beyond {@link detail}, for hover and the reference. */
    documentation?: string;
    /**
     * A short file that uses it. Optional here alone: a Greek letter is a
     * name like any other, and has nothing to show that `a` would not.
     */
    example?: string;
    category: 'greek' | 'mathematical' | 'boolean';
    /**
     * The LaTeX Desmos expects, when it is not simply `\\name`. A constant with
     * no LaTeX form at all - `e`, `true`, `false`, which Desmos writes as
     * themselves - declares `latex: null` and is left alone by the compiler.
     */
    latex?: string | null;
}

/**
 * What a property's value must be (spec §4.2). Precise enough for the checker
 * to enforce and for completions to offer the right thing after the colon.
 *
 * - `expression`: any expression, lowered to latex
 * - `number`: a numeric literal, optionally negated - for the settings Desmos
 *   holds as a JSON number rather than latex
 * - `string`: a string literal
 * - `boolean`: `true`, `false`, or the key written bare as a flag
 * - `enum`: one of {@link PropertyDefinition.values}, written as an identifier
 * - `color`: a `#hex` literal, a palette name, or any other expression (§4.3)
 * - `range`: `lo..hi step s soft` (§4.4)
 * - `action`: an action or an action run
 * - `style`: the name of a `style`
 */
export type PropertyValueType =
    | 'expression'
    | 'number'
    | 'string'
    | 'boolean'
    | 'enum'
    | 'color'
    | 'range'
    | 'action'
    | 'style';

/**
 * Where a property may be written (spec §4.6): trailing an expression, after
 * the `{` of a folder or a table, trailing a table column, an image, a ticker,
 * an import or a note, as an entry of `config`, or as an entry of a `style`.
 */
export type PropertyPlacement =
    | 'expression'
    | 'folder'
    | 'table'
    | 'column'
    | 'image'
    | 'ticker'
    | 'import'
    | 'note'
    | 'config'
    | 'style';

export const AXIS_PROPERTY_PLACEMENTS: readonly PropertyPlacement[] = [
    'expression',
    'folder',
    'table',
    'column',
    'image',
    'ticker',
    'import',
    'note',
    'config',
    'style',
];

/**
 * A `key: value` property: metadata trailing a statement, or an entry of a
 * `config` or `style` block. All of them are written and completed the same
 * way; `appliesTo` is what tells them apart.
 */
export interface PropertyDefinition {
    name: string;
    detail: string;
    /** Markdown beyond {@link detail}, for hover and the reference. */
    documentation?: string;
    /** A short file that uses it (see the head of this file). */
    example: string;
    snippet: string;
    valueType: PropertyValueType;
    /**
     * The identifiers an `enum` property accepts, in the order they are
     * offered, spelt as Desmos spells them. Source may write them in any case
     * ({@link enumValue}).
     */
    values?: readonly string[];
    appliesTo: readonly PropertyPlacement[];
    /** Whether one clause may give it more than once. Only `use` may. */
    repeatable?: boolean;
}

/** A colour Desmos names, which `color: RED` sets without writing the hex. */
export interface PaletteColor {
    name: string;
    /** The hex Desmos gives it, as `Desmos.Colors` does. */
    hex: string;
}

export const AXIS_MANIFEST = {
    functions: [
        // Trigonometric functions
        {
            name: 'sin',
            detail: 'Sine function',
            documentation: 'In radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = sin(x)',
            snippet: 'sin(${1:x})',
            category: 'trig',
            latex: '\\sin',
        },
        {
            name: 'cos',
            detail: 'Cosine function',
            documentation: 'In radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = cos(x)',
            snippet: 'cos(${1:x})',
            category: 'trig',
            latex: '\\cos',
        },
        {
            name: 'tan',
            detail: 'Tangent function',
            documentation: 'In radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = tan(x)',
            snippet: 'tan(${1:x})',
            category: 'trig',
            latex: '\\tan',
        },
        {
            name: 'csc',
            detail: 'Cosecant function',
            documentation:
                'The reciprocal of `sin`. In radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = csc(x)',
            snippet: 'csc(${1:x})',
            category: 'trig',
            latex: '\\csc',
        },
        {
            name: 'sec',
            detail: 'Secant function',
            documentation:
                'The reciprocal of `cos`. In radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = sec(x)',
            snippet: 'sec(${1:x})',
            category: 'trig',
            latex: '\\sec',
        },
        {
            name: 'cot',
            detail: 'Cotangent function',
            documentation:
                'The reciprocal of `tan`. In radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = cot(x)',
            snippet: 'cot(${1:x})',
            category: 'trig',
            latex: '\\cot',
        },
        {
            name: 'arcsin',
            detail: 'Arcsine function',
            documentation: 'Answers in radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = arcsin(x)',
            snippet: 'arcsin(${1:x})',
            category: 'trig',
            latex: '\\arcsin',
        },
        {
            name: 'arccos',
            detail: 'Arccosine function',
            documentation: 'Answers in radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = arccos(x)',
            snippet: 'arccos(${1:x})',
            category: 'trig',
            latex: '\\arccos',
        },
        {
            name: 'arctan',
            detail: 'Arctangent function',
            documentation: 'Answers in radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = arctan(x)',
            snippet: 'arctan(${1:x})',
            category: 'trig',
            latex: '\\arctan',
        },
        {
            name: 'arccsc',
            detail: 'Arccosecant function',
            documentation: 'Answers in radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = arccsc(x)',
            snippet: 'arccsc(${1:x})',
            category: 'trig',
        },
        {
            name: 'arcsec',
            detail: 'Arcsecant function',
            documentation: 'Answers in radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = arcsec(x)',
            snippet: 'arcsec(${1:x})',
            category: 'trig',
        },
        {
            name: 'arccot',
            detail: 'Arccotangent function',
            documentation: 'Answers in radians, unless `config { degreeMode: true }` says degrees.',
            example: 'y = arccot(x)',
            snippet: 'arccot(${1:x})',
            category: 'trig',
        },
        {
            name: 'sinh',
            detail: 'Hyperbolic sine',
            example: 'y = sinh(x)',
            snippet: 'sinh(${1:x})',
            category: 'trig',
            latex: '\\sinh',
        },
        {
            name: 'cosh',
            detail: 'Hyperbolic cosine',
            example: 'y = cosh(x)',
            snippet: 'cosh(${1:x})',
            category: 'trig',
            latex: '\\cosh',
        },
        {
            name: 'tanh',
            detail: 'Hyperbolic tangent',
            example: 'y = tanh(x)',
            snippet: 'tanh(${1:x})',
            category: 'trig',
            latex: '\\tanh',
        },
        {
            name: 'csch',
            detail: 'Hyperbolic cosecant',
            example: 'y = csch(x)',
            snippet: 'csch(${1:x})',
            category: 'trig',
        },
        {
            name: 'sech',
            detail: 'Hyperbolic secant',
            example: 'y = sech(x)',
            snippet: 'sech(${1:x})',
            category: 'trig',
        },
        {
            name: 'coth',
            detail: 'Hyperbolic cotangent',
            example: 'y = coth(x)',
            snippet: 'coth(${1:x})',
            category: 'trig',
            latex: '\\coth',
        },
        {
            name: 'arcsinh',
            detail: 'Inverse hyperbolic sine',
            example: 'y = arcsinh(x)',
            snippet: 'arcsinh(${1:x})',
            category: 'trig',
        },
        {
            name: 'arccosh',
            detail: 'Inverse hyperbolic cosine',
            documentation: 'Defined from 1 up.',
            example: 'y = arccosh(x)',
            snippet: 'arccosh(${1:x})',
            category: 'trig',
        },
        {
            name: 'arctanh',
            detail: 'Inverse hyperbolic tangent',
            documentation: 'Defined between -1 and 1.',
            example: 'y = arctanh(x)',
            snippet: 'arctanh(${1:x})',
            category: 'trig',
        },
        {
            name: 'arccsch',
            detail: 'Inverse hyperbolic cosecant',
            example: 'y = arccsch(x)',
            snippet: 'arccsch(${1:x})',
            category: 'trig',
        },
        {
            name: 'arcsech',
            detail: 'Inverse hyperbolic secant',
            documentation: 'Defined above 0, up to 1.',
            example: 'y = arcsech(x)',
            snippet: 'arcsech(${1:x})',
            category: 'trig',
        },
        {
            name: 'arccoth',
            detail: 'Inverse hyperbolic cotangent',
            documentation: 'Defined outside -1 to 1.',
            example: 'y = arccoth(x)',
            snippet: 'arccoth(${1:x})',
            category: 'trig',
        },

        // Mathematical functions
        {
            name: 'sqrt',
            detail: 'Square root',
            example: 'y = sqrt(x)',
            snippet: 'sqrt(${1:x})',
            category: 'math',
        },
        {
            name: 'nthroot',
            detail: 'Nth root',
            documentation: 'The `n`th root of `x`: `nthroot(8, 3)` is 2.',
            example: 'y = nthroot(x, 3)',
            snippet: 'nthroot(${1:x}, ${2:n})',
            category: 'math',
        },
        {
            name: 'abs',
            detail: 'Absolute value',
            documentation: 'Also written with bars: `|x|`.',
            example: 'y = abs(x)',
            snippet: 'abs(${1:x})',
            category: 'math',
        },
        {
            name: 'ln',
            detail: 'Natural logarithm',
            example: 'y = ln(x)',
            snippet: 'ln(${1:x})',
            category: 'math',
            latex: '\\ln',
        },
        {
            name: 'log',
            detail: 'Logarithm base 10, or to any base with a second argument',
            documentation: '`log(x, b)` is the logarithm of `x` to the base `b`: `log(8, 2)` is 3.',
            example: 'y = log(x)\nz = log(8, 2)',
            snippet: 'log(${1:x})',
            category: 'math',
            latex: '\\log',
        },
        {
            name: 'sum',
            detail: 'Sum of a body over a range: `sum(n = 1..10, n^2)`',
            documentation:
                'The variable is named once, with the range it runs over - both ends included, and either end any expression - and is bound in the body alone.',
            example: 'a = sum(n = 1..10, n^2)\ny = sum(k = 0..5, x^k / k!)',
            snippet: 'sum(${1:n} = ${2:1}..${3:10}, ${4:n})',
            category: 'math',
            latex: '\\sum',
        },
        {
            name: 'prod',
            detail: 'Product of a body over a range: `prod(n = 1..5, n)`',
            documentation:
                'The variable is named once, with the range it runs over - both ends included, and either end any expression - and is bound in the body alone.',
            example: 'a = prod(n = 1..5, n)\ny = prod(k = 1..3, x - k)',
            snippet: 'prod(${1:n} = ${2:1}..${3:10}, ${4:n})',
            category: 'math',
            latex: '\\prod',
        },
        {
            name: 'int',
            detail: 'Definite integral of a body: `int(t = 0..1, t^2)`',
            documentation:
                'The variable of integration is named once, with the bounds - either of them any expression - and is bound in the body alone.',
            example: 'a = int(t = 0..1, t^2)\ny = int(t = 0..x, cos(t))',
            snippet: 'int(${1:t} = ${2:0}..${3:1}, ${4:t})',
            category: 'math',
            latex: '\\int',
        },
        {
            name: 'exp',
            detail: 'Exponential (e^x)',
            documentation: 'The same as `e ^ x`.',
            example: 'y = exp(x)',
            snippet: 'exp(${1:x})',
            category: 'math',
            latex: '\\exp',
        },
        {
            name: 'floor',
            detail: 'Floor function',
            example: 'y = floor(x)',
            snippet: 'floor(${1:x})',
            category: 'math',
        },
        {
            name: 'ceil',
            detail: 'Ceiling function',
            example: 'y = ceil(x)',
            snippet: 'ceil(${1:x})',
            category: 'math',
        },
        {
            name: 'round',
            detail: 'Round function',
            example: 'y = round(x)',
            snippet: 'round(${1:x})',
            category: 'math',
        },
        {
            name: 'sign',
            detail: 'Sign function',
            documentation:
                '-1 for a negative number, 1 for a positive one, and 0 for 0. `sgn` is the same function.',
            example: 'y = sign(x)',
            snippet: 'sign(${1:x})',
            category: 'math',
        },
        // Desmos accepts `sign` and writes `sgn` back, so both are names Axis
        // has to know: the one an author types and the one a graph read off
        // desmos.com arrives spelled with.
        {
            name: 'sgn',
            detail: 'Sign function',
            documentation: 'Another name for `sign`.',
            example: 'y = sgn(x)',
            snippet: 'sgn(${1:x})',
            category: 'math',
        },
        {
            name: 'mod',
            detail: 'Modulo',
            documentation: 'The remainder of `x` divided by `y`.',
            example: 'y = mod(x, 3)',
            snippet: 'mod(${1:x}, ${2:y})',
            category: 'math',
        },
        {
            name: 'gcd',
            detail: 'Greatest common divisor',
            example: 'a = gcd(12, 18)',
            snippet: 'gcd(${1:x}, ${2:y})',
            category: 'math',
            latex: '\\gcd',
        },
        {
            name: 'lcm',
            detail: 'Least common multiple',
            example: 'a = lcm(4, 6)',
            snippet: 'lcm(${1:x}, ${2:y})',
            category: 'math',
        },
        {
            name: 'erf',
            detail: 'Error function',
            documentation:
                'The integral of `2 / sqrt(pi) exp(-t^2)` from 0 to `x`, which has no closed form.',
            example: 'y = erf(x)',
            snippet: 'erf(${1:x})',
            category: 'math',
        },

        // Statistical functions
        {
            name: 'total',
            detail: 'Sum of list',
            example: 'L = [3, 1, 4, 1, 5]\ns = total(L)',
            snippet: 'total(${1:list})',
            category: 'statistics',
        },
        {
            name: 'length',
            detail: 'Length of list',
            example: 'L = [3, 1, 4, 1, 5]\nn = length(L)',
            snippet: 'length(${1:list})',
            category: 'statistics',
        },
        {
            name: 'count',
            detail: 'Number of elements in a list; also written `list.count`',
            documentation:
                'Like every function of one list, it may be written after the list as a member: `L.count`.',
            example: 'L = [3, 1, 4, 1, 5]\nn = count(L)\nm = L.count',
            snippet: 'count(${1:list})',
            category: 'statistics',
        },
        {
            name: 'mean',
            detail: 'Mean of list',
            example: 'L = [3, 1, 4, 1, 5]\nm = mean(L)',
            snippet: 'mean(${1:list})',
            category: 'statistics',
        },
        {
            name: 'median',
            detail: 'Median of list',
            example: 'L = [3, 1, 4, 1, 5]\nm = median(L)',
            snippet: 'median(${1:list})',
            category: 'statistics',
        },
        {
            name: 'min',
            detail: 'Minimum of list',
            example: 'L = [3, 1, 4, 1, 5]\nm = min(L)',
            snippet: 'min(${1:list})',
            category: 'statistics',
            latex: '\\min',
        },
        {
            name: 'max',
            detail: 'Maximum of list',
            example: 'L = [3, 1, 4, 1, 5]\nm = max(L)',
            snippet: 'max(${1:list})',
            category: 'statistics',
            latex: '\\max',
        },
        {
            name: 'stdev',
            detail: 'Standard deviation',
            documentation: 'The sample standard deviation. `stdevp` is the population one.',
            example: 'L = [3, 1, 4, 1, 5]\ns = stdev(L)',
            snippet: 'stdev(${1:list})',
            category: 'statistics',
        },
        {
            name: 'stdevp',
            detail: 'Population standard deviation',
            example: 'L = [3, 1, 4, 1, 5]\ns = stdevp(L)',
            snippet: 'stdevp(${1:list})',
            category: 'statistics',
        },
        {
            name: 'mad',
            detail: 'Mean absolute deviation',
            example: 'L = [3, 1, 4, 1, 5]\nd = mad(L)',
            snippet: 'mad(${1:list})',
            category: 'statistics',
        },
        {
            name: 'var',
            detail: 'Variance',
            documentation: 'The sample variance. `varp` is the population one.',
            example: 'L = [3, 1, 4, 1, 5]\nv = var(L)',
            snippet: 'var(${1:list})',
            category: 'statistics',
        },
        {
            name: 'varp',
            detail: 'Population variance',
            example: 'L = [3, 1, 4, 1, 5]\nv = varp(L)',
            snippet: 'varp(${1:list})',
            category: 'statistics',
        },
        {
            name: 'quantile',
            detail: 'The value a fraction p of the way through a list',
            documentation:
                '`quantile(L, 0.5)` is the median. `p` runs from 0 to 1, and the answer is interpolated between the two values it falls between.',
            example: 'L = [3, 1, 4, 1, 5]\nq = quantile(L, 0.9)',
            snippet: 'quantile(${1:list}, ${2:p})',
            category: 'statistics',
        },
        {
            name: 'quartile',
            detail: 'The first, second or third quartile of a list',
            documentation: '`quartile(L, 2)` is the median; 0 and 4 are the minimum and maximum.',
            example: 'L = [3, 1, 4, 1, 5]\nq = quartile(L, 1)',
            snippet: 'quartile(${1:list}, ${2:n})',
            category: 'statistics',
        },
        {
            name: 'cov',
            detail: 'Covariance of two lists',
            documentation: 'The sample covariance. `covp` is the population one.',
            example: 'xs = [1, 2, 3, 4]\nys = [2, 4, 5, 9]\nc = cov(xs, ys)',
            snippet: 'cov(${1:xs}, ${2:ys})',
            category: 'statistics',
        },
        {
            name: 'covp',
            detail: 'Population covariance of two lists',
            example: 'xs = [1, 2, 3, 4]\nys = [2, 4, 5, 9]\nc = covp(xs, ys)',
            snippet: 'covp(${1:xs}, ${2:ys})',
            category: 'statistics',
        },
        {
            name: 'corr',
            detail: 'Correlation coefficient of two lists',
            documentation: "Pearson's r, from -1 to 1.",
            example: 'xs = [1, 2, 3, 4]\nys = [2, 4, 5, 9]\nr = corr(xs, ys)',
            snippet: 'corr(${1:xs}, ${2:ys})',
            category: 'statistics',
        },
        {
            name: 'spearman',
            detail: 'Rank correlation of two lists',
            documentation:
                "Spearman's rho: the correlation of the two lists' ranks, so any rising relationship scores 1.",
            example: 'xs = [1, 2, 3, 4]\nys = [2, 4, 5, 9]\nr = spearman(xs, ys)',
            snippet: 'spearman(${1:xs}, ${2:ys})',
            category: 'statistics',
        },
        {
            name: 'tscore',
            detail: "The t-score of a list's mean against a value",
            documentation: '`(mean(L) - mu) / (stdev(L) / sqrt(length(L)))`.',
            example: 'L = [3, 1, 4, 1, 5]\nt = tscore(L, 2)',
            snippet: 'tscore(${1:list}, ${2:mu})',
            category: 'statistics',
        },
        {
            name: 'discretedist',
            detail: 'Discrete distribution over values with optional weights (new in Desmos v1.12)',
            documentation: 'Without weights, every value is equally likely.',
            example: 'D = discretedist([1, 2, 3], [0.2, 0.3, 0.5])',
            snippet: 'discretedist(${1:values}, ${2:weights})',
            category: 'statistics',
        },
        {
            name: 'random',
            detail: 'Random number in [0, 1); random(n) gives a list of n, random(list) shuffles it',
            documentation:
                'The numbers stay put until the graph is reseeded; `config { randomSeed: "…" }` fixes the seed.',
            example: 'a = random()\nL = random(5)',
            snippet: 'random(${1:})',
            category: 'statistics',
        },

        // List generation
        {
            name: 'repeat',
            detail: 'Repeat a value or list n times (new in Desmos v1.12)',
            example: 'L = repeat(2, 3)',
            snippet: 'repeat(${1:value}, ${2:n})',
            category: 'list',
        },
        {
            name: 'join',
            detail: 'Concatenate lists or values into one list',
            example: 'L = join([1, 2], [3, 4])',
            snippet: 'join(${1:a}, ${2:b})',
            category: 'list',
        },
        {
            name: 'sort',
            detail: 'Sort a list, optionally by a second list',
            documentation: 'Given a second list, sorts the first by it.',
            example: 'L = sort([3, 1, 2])\nM = sort([10, 20, 30], [3, 1, 2])',
            snippet: 'sort(${1:list})',
            category: 'list',
        },
        {
            name: 'unique',
            detail: 'The distinct values of a list, in the order they first appear',
            example: 'L = unique([1, 2, 2, 3, 1])',
            snippet: 'unique(${1:list})',
            category: 'list',
        },
        {
            name: 'shuffle',
            detail: 'A list in random order',
            example: 'L = shuffle([1, 2, 3, 4, 5])',
            snippet: 'shuffle(${1:list})',
            category: 'list',
        },

        // Geometry — take points, not numbers
        {
            name: 'polygon',
            detail: 'Polygon from points or a point list',
            documentation: 'Takes the vertices as separate points, or one list of points.',
            example: 'polygon((0, 0), (4, 0), (2, 3))',
            snippet: 'polygon(${1:points})',
            category: 'geometry',
        },
        {
            name: 'polygonGlider',
            detail: "The point a fraction of the way around a polygon's perimeter",
            example: 'T = polygon((0, 0), (4, 0), (2, 3))\npolygonGlider(T, 0.5)',
            snippet: 'polygonGlider(${1:polygon}, ${2:t})',
            category: 'geometry',
        },
        {
            name: 'polygonInteriorDirectedAngles',
            detail: 'The signed interior angles of a polygon',
            example: 'T = polygon((0, 0), (4, 0), (2, 3))\nA = polygonInteriorDirectedAngles(T, 1)',
            snippet: 'polygonInteriorDirectedAngles(${1:polygon}, ${2:n})',
            category: 'geometry',
        },
        {
            name: 'distance',
            detail: 'Distance between two points',
            example: 'd = distance((0, 0), (3, 4))',
            snippet: 'distance(${1:A}, ${2:B})',
            category: 'geometry',
        },
        {
            name: 'midpoint',
            detail: 'Midpoint of two points',
            example: 'midpoint((0, 0), (4, 2))',
            snippet: 'midpoint(${1:A}, ${2:B})',
            category: 'geometry',
        },

        // Color functions — ok* spaces are perceptually uniform (new in Desmos v1.12)
        {
            name: 'rgb',
            detail: 'Color from red, green, blue (0-255)',
            documentation:
                'Each channel runs from 0 to 255. A colour is a value like any other, so it may be stored in a variable and given to `color:`.',
            example: 'y = sin(x) @ color: rgb(255, 128, 0)',
            snippet: 'rgb(${1:r}, ${2:g}, ${3:b})',
            category: 'color',
        },
        {
            name: 'hsv',
            detail: 'Color from hue, saturation, value',
            documentation: 'Hue in degrees, 0 to 360; saturation and value from 0 to 1.',
            example: 'y = sin(x) @ color: hsv(200, 0.8, 0.9)',
            snippet: 'hsv(${1:h}, ${2:s}, ${3:v})',
            category: 'color',
        },
        {
            name: 'okhsv',
            detail: 'Perceptually uniform color from hue, saturation, value (new in Desmos v1.12)',
            example: 'y = sin(x) @ color: okhsv(200, 0.8, 0.9)',
            snippet: 'okhsv(${1:h}, ${2:s}, ${3:v})',
            category: 'color',
        },
        {
            name: 'oklab',
            detail: 'Perceptually uniform color from lightness, a, b (new in Desmos v1.12)',
            example: 'y = sin(x) @ color: oklab(0.6, 0.1, -0.1)',
            snippet: 'oklab(${1:l}, ${2:a}, ${3:b})',
            category: 'color',
        },
        {
            name: 'oklch',
            detail: 'Perceptually uniform color from lightness, chroma, hue (new in Desmos v1.12)',
            example: 'y = sin(x) @ color: oklch(0.6, 0.15, 30)',
            snippet: 'oklch(${1:l}, ${2:c}, ${3:h})',
            category: 'color',
        },

        // Combinatorics
        {
            name: 'nCr',
            detail: 'Combinations',
            documentation: 'How many ways to choose `r` of `n` things, order not counting.',
            example: 'a = nCr(5, 2)',
            snippet: 'nCr(${1:n}, ${2:r})',
            category: 'combinatorics',
        },
        {
            name: 'nPr',
            detail: 'Permutations',
            documentation: 'How many ways to arrange `r` of `n` things, order counting.',
            example: 'a = nPr(5, 2)',
            snippet: 'nPr(${1:n}, ${2:r})',
            category: 'combinatorics',
        },
        {
            name: 'factorial',
            detail: 'Factorial',
            documentation: 'Also written postfix: `5!`.',
            example: 'a = factorial(5)\nb = 5!',
            snippet: 'factorial(${1:n})',
            category: 'combinatorics',
        },

        // Complex numbers - Desmos knows these only in complex mode
        {
            name: 'real',
            detail: 'Real part of a complex number',
            documentation: 'Only in complex mode, which `config { allowComplex: true }` turns on.',
            example: 'config { allowComplex: true }\nz = 3 + 4i\na = real(z)',
            snippet: 'real(${1:z})',
            category: 'complex',
            complex: true,
        },
        {
            name: 'imag',
            detail: 'Imaginary part of a complex number',
            documentation: 'Only in complex mode, which `config { allowComplex: true }` turns on.',
            example: 'config { allowComplex: true }\nz = 3 + 4i\nb = imag(z)',
            snippet: 'imag(${1:z})',
            category: 'complex',
            complex: true,
        },
        {
            name: 'conj',
            detail: 'Complex conjugate',
            documentation: 'Only in complex mode, which `config { allowComplex: true }` turns on.',
            example: 'config { allowComplex: true }\nz = 3 + 4i\nw = conj(z)',
            snippet: 'conj(${1:z})',
            category: 'complex',
            complex: true,
        },
        {
            name: 'arg',
            detail: 'Argument (angle) of a complex number',
            documentation:
                'The angle from the positive real axis, from -π to π. Only in complex mode, which `config { allowComplex: true }` turns on.',
            example: 'config { allowComplex: true }\nz = 3 + 4i\nm = arg(z)',
            snippet: 'arg(${1:z})',
            category: 'complex',
            complex: true,
            latex: '\\arg',
        },

        // Audio — plays rather than draws, and is gated by the `tone` config
        // property and by the calculator being unmuted
        {
            name: 'tone',
            detail: 'Play a tone at a frequency in hertz, at a volume of 0-1',
            documentation: 'Desmos shows a button to play it.',
            example: 'tone(440, 0.5)',
            snippet: 'tone(${1:frequency}, ${2:volume})',
            category: 'audio',
        },
    ] satisfies FunctionDefinition[],

    operators: [
        {
            name: 'width',
            detail: 'Viewport width, in graph units',
            documentation: 'Follows the viewport as it is panned and zoomed.',
            example: 'x = width / 4',
            category: 'viewport',
        },
        {
            name: 'height',
            detail: 'Viewport height, in graph units',
            documentation: 'Follows the viewport as it is panned and zoomed.',
            example: 'y = height / 4',
            category: 'viewport',
        },
        {
            name: 'for',
            detail: 'List comprehension: [i ^ 2 for i = [1...10]]',
            documentation:
                'Builds a list by running the expression before it over every element of a list. More than one binding, `for i = A, j = B`, runs over every pair.',
            example: 'S = [i ^ 2 for i = [1...10]]\n[(i, i ^ 2) for i = [1...5]]',
            category: 'list',
        },
        {
            name: 'with',
            detail: 'Local definition: f(x) = x n with n = length(a)',
            documentation:
                'Substitutes values into the expression before it. The bindings run to the end of the bracket or statement.',
            example: 'y = a x ^ 2 with a = 0.5',
            category: 'scope',
        },
        {
            name: 'index',
            detail: "The element's 1-based position, inside a list filter or a clickable action",
            documentation: 'Which element of a list was clicked, counting from 1.',
            example: 'n = 0\nP = [(1, 1), (2, 2), (3, 3)] @ onClick: n -> index, pointSize: 20',
            category: 'list',
        },
        {
            // Desmos provides it to a ticker's handler and nowhere else: the
            // emitter writes `\operatorname{dt}`, which Desmos rejects in any
            // other expression. Known here so `n -> n + dt` is not taken for
            // an undefined variable and offered as a slider.
            name: 'dt',
            detail: 'Milliseconds since the last tick - only valid in a ticker handler',
            documentation:
                "Written anywhere but the ticker's handler it is an error, `dt-outside-ticker`.",
            example: 'n = 0\nticker n -> n + dt @ playing',
            category: 'ticker',
        },
    ] satisfies OperatorDefinition[],

    constants: [
        // Greek letters
        { name: 'pi', detail: 'π ≈ 3.14159', example: 'y = sin(pi x)', category: 'greek' },
        {
            name: 'tau',
            detail: 'τ = 2π ≈ 6.28318',
            example: '(cos(t), sin(t)) @ domain: 0..tau',
            category: 'greek',
        },
        {
            name: 'theta',
            detail: 'Greek letter θ',
            documentation:
                'The polar angle. `r = …` in terms of `theta` is a polar curve, and `theta` cannot be defined.',
            example: 'r = 1 + cos(theta)',
            category: 'greek',
        },
        { name: 'alpha', detail: 'Greek letter α', category: 'greek' },
        { name: 'beta', detail: 'Greek letter β', category: 'greek' },
        { name: 'gamma', detail: 'Greek letter γ', category: 'greek' },
        { name: 'delta', detail: 'Greek letter δ', category: 'greek' },
        { name: 'epsilon', detail: 'Greek letter ε', category: 'greek' },
        { name: 'zeta', detail: 'Greek letter ζ', category: 'greek' },
        { name: 'eta', detail: 'Greek letter η', category: 'greek' },
        { name: 'iota', detail: 'Greek letter ι', category: 'greek' },
        { name: 'kappa', detail: 'Greek letter κ', category: 'greek' },
        { name: 'lambda', detail: 'Greek letter λ', category: 'greek' },
        { name: 'mu', detail: 'Greek letter μ', category: 'greek' },
        { name: 'nu', detail: 'Greek letter ν', category: 'greek' },
        { name: 'xi', detail: 'Greek letter ξ', category: 'greek' },
        { name: 'rho', detail: 'Greek letter ρ', category: 'greek' },
        { name: 'sigma', detail: 'Greek letter σ', category: 'greek' },
        { name: 'phi', detail: 'Greek letter φ', category: 'greek' },
        { name: 'chi', detail: 'Greek letter χ', category: 'greek' },
        { name: 'psi', detail: 'Greek letter ψ', category: 'greek' },
        { name: 'omega', detail: 'Greek letter ω', category: 'greek' },
        { name: 'Gamma', detail: 'Greek letter Γ', category: 'greek' },
        { name: 'Delta', detail: 'Greek letter Δ', category: 'greek' },
        { name: 'Theta', detail: 'Greek letter Θ', category: 'greek' },
        { name: 'Lambda', detail: 'Greek letter Λ', category: 'greek' },
        { name: 'Xi', detail: 'Greek letter Ξ', category: 'greek' },
        { name: 'Pi', detail: 'Greek letter Π', category: 'greek' },
        { name: 'Sigma', detail: 'Greek letter Σ', category: 'greek' },
        { name: 'Phi', detail: 'Greek letter Φ', category: 'greek' },
        { name: 'Psi', detail: 'Greek letter Ψ', category: 'greek' },
        { name: 'Omega', detail: 'Greek letter Ω', category: 'greek' },

        // Mathematical constants
        {
            name: 'e',
            detail: "Euler's number ≈ 2.71828",
            example: 'y = e ^ x',
            category: 'mathematical',
            latex: null,
        },
        {
            name: 'infinity',
            detail: '∞',
            example: 'a = 1 / infinity\nb = arctan(infinity)',
            category: 'mathematical',
            latex: '\\infty',
        },

        // Boolean
        {
            name: 'true',
            detail: 'Boolean true',
            documentation: 'A metadata value only: Desmos has no booleans in an expression.',
            example: '(1, 2) @ showLabel: true, label: "P"',
            category: 'boolean',
            latex: null,
        },
        {
            name: 'false',
            detail: 'Boolean false',
            documentation: 'A metadata value only: Desmos has no booleans in an expression.',
            example: 'y = x @ lines: false',
            category: 'boolean',
            latex: null,
        },
    ] satisfies ConstantDefinition[],

    /**
     * Properties written after an `@`, annotating the statement they trail.
     *
     * `appliesTo` is where each one is legal (spec §4.6). `style` is listed on
     * everything an expression or a column takes, since that is what a style
     * is applied to; `table` on everything a column takes, which the table
     * hands to each of its columns as a default the column's own metadata
     * overrides.
     */
    metadata: [
        {
            name: 'use',
            detail: "Apply a style, e.g. `use: emphasis`. Repeatable; applied in order, and the clause's own properties win",
            documentation:
                'Styles apply in the order written, and a property written on the statement itself wins over every style.',
            example:
                'style thick { lineWidth: 5; lineStyle: DASHED }\ny = sin(x) @ use: thick, color: RED',
            snippet: 'use: ${1:style}',
            valueType: 'style',
            appliesTo: ['expression', 'column', 'table', 'style'],
            repeatable: true,
        },
        {
            name: 'color',
            detail: 'Colour: #hex, a palette name (RED, BLUE, GREEN, PURPLE, ORANGE, BLACK), or any expression such as rgb(255, 0, 0) [default: cycles]',
            documentation:
                'A palette name is case-sensitive - `red` would be r·e·d - and any expression that works out a colour may be used.',
            example:
                'y = x ^ 2 @ color: RED\ny = x ^ 2 + 1 @ color: #2d70b3\ny = x ^ 2 + 2 @ color: rgb(200, 100, 0)',
            snippet: 'color: ${1|RED,BLUE,GREEN,PURPLE,ORANGE,BLACK|}',
            valueType: 'color',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'suppressTextOutline',
            detail: 'Drop the outline drawn behind a label [default: false]',
            example: '(1, 2) @ label: "P", showLabel, suppressTextOutline',
            snippet: 'suppressTextOutline',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'lineStyle',
            detail: 'Line style [default: SOLID]',
            example: 'y = sin(x) @ lineStyle: DASHED',
            snippet: 'lineStyle: ${1|SOLID,DASHED,DOTTED|}',
            valueType: 'enum',
            values: ['SOLID', 'DASHED', 'DOTTED'],
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'lineWidth',
            detail: 'Line width in pixels [default: 2.5]',
            example: 'y = cos(x) @ lineWidth: 5',
            snippet: 'lineWidth: ${1:2.5}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'lineOpacity',
            detail: 'Line opacity 0-1 [default: 0.9]',
            example: 'y = cos(x) @ lineOpacity: 0.3',
            snippet: 'lineOpacity: ${1:0.9}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'pointStyle',
            detail: 'Point style [default: POINT]',
            example: '(1, 1) @ pointStyle: STAR, pointSize: 16',
            snippet: 'pointStyle: ${1|POINT,OPEN,CROSS,SQUARE,PLUS,TRIANGLE,DIAMOND,STAR|}',
            valueType: 'enum',
            values: ['POINT', 'OPEN', 'CROSS', 'SQUARE', 'PLUS', 'TRIANGLE', 'DIAMOND', 'STAR'],
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'pointSize',
            detail: 'Point diameter in pixels [default: 9]',
            example: '(1, 1) @ pointSize: 20',
            snippet: 'pointSize: ${1:9}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'movablePointSize',
            detail: 'Point diameter in pixels while the point is draggable [default: matches pointSize]',
            example: 'a = 1\n(a, 2) @ movablePointSize: 16',
            snippet: 'movablePointSize: ${1:9}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'pointOpacity',
            detail: 'Point opacity 0-1 [default: 0.9]',
            example: '(1, 1) @ pointOpacity: 0.4',
            snippet: 'pointOpacity: ${1:0.9}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'fillOpacity',
            detail: 'Fill opacity 0-1 [default: 0.4]',
            example: 'polygon((0, 0), (2, 0), (1, 2)) @ fillOpacity: 0.7',
            snippet: 'fillOpacity: ${1:0.4}',
            valueType: 'expression',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'hidden',
            detail: 'Hide graph [default: false]',
            documentation: 'The statement still defines what it defines; it is only not drawn.',
            example: 'f(x) = x ^ 2 @ hidden\ny = f(x) + 1',
            snippet: 'hidden',
            valueType: 'boolean',
            appliesTo: ['expression', 'column', 'table', 'folder', 'image', 'import', 'style'],
        },
        {
            name: 'secret',
            detail: 'Hide from the expression list, for authors [default: false]',
            documentation: 'Hidden from anyone reading the expression list, not from the author.',
            example: 'k = 3 @ secret\ny = k sin(x)',
            snippet: 'secret',
            valueType: 'boolean',
            appliesTo: ['expression', 'folder', 'image', 'import', 'note', 'style'],
        },
        {
            name: 'points',
            detail: 'Show points [default: true]',
            example: '[(0, 0), (1, 2), (2, 1)] @ lines, points: false',
            snippet: 'points: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'lines',
            detail: 'Show lines [default: true]',
            documentation: 'A list of points draws only the points unless it says `lines`.',
            example: '[(0, 0), (1, 2), (2, 1)] @ lines',
            snippet: 'lines: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'fill',
            detail: 'Fill region [default: false]',
            example: '(cos(t), sin(t)) @ fill, domain: 0..tau',
            snippet: 'fill',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'label',
            detail: 'Point label text [default: empty]',
            example: 'P = (2, 1) @ label: "P", showLabel',
            snippet: 'label: "${1:}"',
            valueType: 'string',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'showLabel',
            detail: 'Show label [default: false]',
            example: 'P = (2, 1) @ label: "P", showLabel',
            snippet: 'showLabel',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'labelSize',
            detail: 'Label size multiplier [default: 1]',
            example: '(2, 1) @ label: "big", showLabel, labelSize: 2',
            snippet: 'labelSize: ${1:1}',
            valueType: 'expression',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'labelOrientation',
            detail: 'Label position [default: default]',
            example: '(2, 1) @ label: "above", showLabel, labelOrientation: above',
            snippet:
                'labelOrientation: ${1|default,above,below,left,right,above_left,above_right,below_left,below_right|}',
            valueType: 'enum',
            values: [
                'default',
                'above',
                'below',
                'left',
                'right',
                'above_left',
                'above_right',
                'below_left',
                'below_right',
            ],
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'labelAngle',
            detail: 'Turn the label by an angle [default: 0]',
            documentation:
                'Counter-clockwise, in radians unless `config { degreeMode: true }` says degrees.',
            example: '(2, 1) @ label: "tilted", showLabel, labelAngle: pi / 4',
            snippet: 'labelAngle: ${1:0}',
            valueType: 'expression',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'interactiveLabel',
            detail: 'Show the label only when the point is hovered or clicked [default: false]',
            documentation:
                'Desmos switches it off on a point that can be dragged, so it goes with `dragMode: none` on a movable point.',
            example: '(2, 1) @ label: "hidden until clicked", showLabel, interactiveLabel',
            snippet: 'interactiveLabel',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'editableLabelMode',
            detail: 'Let the viewer edit the label in place, as math or as text [default: NONE]',
            documentation:
                'A `MATH` label is edited as an expression and a `TEXT` one as words; either is typed into on the graph itself.',
            example: 'P = (2, 1) @ label: "edit me", showLabel, editableLabelMode: TEXT',
            snippet: 'editableLabelMode: ${1|NONE,MATH,TEXT|}',
            valueType: 'enum',
            values: ['NONE', 'MATH', 'TEXT'],
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'displayEvaluationAsFraction',
            detail: "Show the expression's value as a fraction [default: false]",
            example: 'a = 1 / 3 @ displayEvaluationAsFraction',
            snippet: 'displayEvaluationAsFraction',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'pointOutline',
            detail: 'Ring each point in the background colour [default: false]',
            example: '(1, 1) @ pointOutline, pointSize: 16',
            snippet: 'pointOutline',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'dragMode',
            detail: 'Drag mode [default: AUTO]',
            documentation:
                '`X` and `Y` let a point move along one axis only; `NONE` pins it. On an image, any mode but `NONE` makes it draggable.',
            example: 'P = (1, 2) @ dragMode: X',
            snippet: 'dragMode: ${1|AUTO,X,Y,XY,NONE|}',
            valueType: 'enum',
            values: ['AUTO', 'X', 'Y', 'XY', 'NONE'],
            appliesTo: ['expression', 'column', 'table', 'image', 'style'],
        },
        {
            name: 'playing',
            detail: 'Animate slider [default: false]',
            example: 'a = 1 @ slider: 0..5, playing\ny = a sin(x)',
            snippet: 'playing',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'onClick',
            detail: 'Action run when the object is clicked, e.g. `onClick: a -> a + 1` or a run `a -> 1, b -> 2`',
            documentation:
                'An action, `target -> value`, or a run of them separated by commas, which happen together. The comma after the run starts the next property only when an `identifier:` follows it.',
            example: 'n = 0\n(n, 0) @ onClick: n -> n + 1, pointSize: 20',
            snippet: 'onClick: ${1:a} -> ${2:value}',
            valueType: 'action',
            appliesTo: ['expression', 'image', 'style'],
        },
        {
            name: 'clickable',
            detail: 'Enable/disable the onClick action [default: true when onClick is set]',
            example: 'n = 0\n(0, 0) @ onClick: n -> n + 1, clickable: false',
            snippet: 'clickable: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['expression', 'image', 'style'],
        },
        {
            name: 'description',
            detail: 'Screen-reader description, shown for clickable objects',
            example: 'n = 0\n(0, 0) @ onClick: n -> n + 1, description: "Count up"',
            snippet: 'description: "${1:}"',
            valueType: 'string',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'slider',
            detail: "Slider range for a defined value, e.g. `slider: -5..5 step 0.5`. Both ends are limits unless `soft`, `soft min` or `soft max` says otherwise, and either end may be left out to keep Desmos' own",
            documentation:
                "A stepped slider snaps its value to the step's grid, counted from its `min`.",
            example: 'a = 2 @ slider: 0..10 step 0.5\nb = 1 @ slider: 0.. soft\ny = a x + b',
            snippet: 'slider: ${1:0}..${2:10}',
            valueType: 'range',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'loopMode',
            detail: 'What an animating slider does at the end of its range [default: LOOP_FORWARD_REVERSE]',
            example: 'a = 0 @ slider: 0..5, playing, loopMode: LOOP_FORWARD',
            snippet:
                'loopMode: ${1|LOOP_FORWARD_REVERSE,LOOP_FORWARD,PLAY_ONCE,PLAY_INDEFINITELY|}',
            valueType: 'enum',
            values: ['LOOP_FORWARD_REVERSE', 'LOOP_FORWARD', 'PLAY_ONCE', 'PLAY_INDEFINITELY'],
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'playDirection',
            detail: 'Which way an animating slider runs: 1 forwards, -1 backwards [default: 1]',
            example: 'a = 5 @ slider: 0..5, playing, playDirection: -1',
            snippet: 'playDirection: ${1|1,-1|}',
            valueType: 'number',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'animationPeriod',
            detail: 'How long one sweep of an animating slider takes, in milliseconds [default: 8000]',
            example: 'a = 0 @ slider: 0..10, playing, animationPeriod: 2000',
            snippet: 'animationPeriod: ${1:8000}',
            valueType: 'number',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'domain',
            detail: 'The range a parametric or polar curve is drawn over, e.g. `domain: 0..2pi`',
            documentation:
                'A parametric curve given no domain runs `t` over [0, 1], not a whole period.',
            example: '(cos(t), sin(2t)) @ domain: 0..tau',
            snippet: 'domain: ${1:0}..${2:2pi}',
            valueType: 'range',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'parametricDomain',
            detail: 'The older copy of `domain` Desmos writes beside it, for a graph whose two disagree',
            example: '(t, t ^ 2) @ parametricDomain: -2..2',
            snippet: 'parametricDomain: ${1:0}..${2:2pi}',
            valueType: 'range',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'polarDomain',
            detail: 'The range a polar curve is drawn over in polar mode, e.g. `polarDomain: 0..2pi`',
            example: 'r = theta / 4 @ polarDomain: 0..6pi',
            snippet: 'polarDomain: ${1:0}..${2:2pi}',
            valueType: 'range',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'name',
            detail: 'The caption an image carries in the expression list',
            example: 'image "./images/wave.png" @ name: "A wave"',
            snippet: 'name: "${1:}"',
            valueType: 'string',
            appliesTo: ['image'],
        },
        {
            name: 'center',
            detail: 'The point an image is centred on, e.g. `center: (0, 0)`',
            example: 'image "./images/wave.png" @ center: (2, 3)',
            snippet: 'center: (${1:0}, ${2:0})',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'width',
            detail: 'How wide an image is drawn, in graph units',
            example: 'image "./images/wave.png" @ width: 8',
            snippet: 'width: ${1:10}',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'height',
            detail: 'How tall an image is drawn, in graph units',
            example: 'image "./images/wave.png" @ height: 4',
            snippet: 'height: ${1:10}',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'angle',
            detail: 'How far an image is rotated, anticlockwise, in radians',
            example: 'image "./images/wave.png" @ angle: pi / 6',
            snippet: 'angle: ${1:0}',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'opacity',
            detail: 'Image opacity 0-1 [default: 1]',
            example: 'image "./images/wave.png" @ opacity: 0.5',
            snippet: 'opacity: ${1:1}',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'foreground',
            detail: 'Draw an image over the graph rather than under it [default: false]',
            example: 'image "./images/wave.png" @ foreground\ny = sin(x)',
            snippet: 'foreground',
            valueType: 'boolean',
            appliesTo: ['image'],
        },
        {
            name: 'collapsed',
            detail: 'Start a folder collapsed [default: false; an import starts collapsed]',
            example: 'folder "Waves" { @ collapsed\n    y = sin(x)\n    y = cos(x)\n}',
            snippet: 'collapsed: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['folder', 'import'],
        },
    ] satisfies PropertyDefinition[],

    /** The words the lexer never reads as identifiers (spec §2.2). */
    keywords: [...KEYWORDS] satisfies string[],

    /**
     * The `@ key: value` properties a `ticker` statement takes.
     *
     * Their own list rather than entries of {@link AXIS_MANIFEST.metadata},
     * because a ticker is not an expression and none of them means anything on
     * one: `minStep` on `y = x` would be as wrong as `lineWidth` on a ticker.
     * `playing` is spelled the same in both places and means the same thing in
     * each - start moving as soon as the graph opens - so looking one up needs
     * the placement as well as the name ({@link findProperty}).
     */
    tickerProperties: [
        {
            name: 'minStep',
            detail: 'Shortest gap between ticks, in milliseconds, 0 for every frame [default: 0]',
            example: 'n = 0\nticker n -> n + 1 @ minStep: 100, playing',
            snippet: 'minStep: ${1:50}',
            valueType: 'expression',
            appliesTo: ['ticker'],
        },
        {
            name: 'playing',
            detail: 'Start the ticker running when the graph opens [default: false]',
            example: 't = 0\nticker t -> t + dt / 1000 @ playing\ny = sin(x - t)',
            snippet: 'playing',
            valueType: 'boolean',
            appliesTo: ['ticker'],
        },
        {
            name: 'open',
            detail: 'Show the ticker expanded in the expression list [default: false]',
            example: 'n = 0\nticker n -> n + 1 @ open',
            snippet: 'open',
            valueType: 'boolean',
            appliesTo: ['ticker'],
        },
    ] satisfies PropertyDefinition[],

    /** Entries of the `config` block, which become the calculator's settings. */
    configProperties: [
        {
            name: 'calculator',
            detail: 'Which Desmos calculator draws the graph [default: GRAPHING]',
            documentation:
                'The geometry and 3D calculators draw the same expressions the graphing calculator does; ' +
                'their own tools are not in Axis yet.',
            example: 'config { calculator: GEOMETRY }\nP = (1, 2)\ny = x',
            snippet: 'calculator: ${1|GRAPHING,GEOMETRY,GRAPHING_3D|}',
            valueType: 'enum',
            values: ['GRAPHING', 'GEOMETRY', 'GRAPHING_3D'],
            appliesTo: ['config'],
        },
        {
            name: 'degreeMode',
            detail: 'Use degrees instead of radians [default: false]',
            example: 'config { degreeMode: true }\ny = sin(x)',
            snippet: 'degreeMode: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showGrid',
            detail: 'Show coordinate grid [default: true]',
            example: 'config { showGrid: false }\ny = sin(x)',
            snippet: 'showGrid: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showXAxis',
            detail: 'Show x-axis [default: true]',
            example: 'config { showXAxis: false }\ny = sin(x)',
            snippet: 'showXAxis: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showYAxis',
            detail: 'Show y-axis [default: true]',
            example: 'config { showYAxis: false }\ny = sin(x)',
            snippet: 'showYAxis: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'xAxisNumbers',
            detail: 'Show numbers on x-axis [default: true]',
            example: 'config { xAxisNumbers: false }\ny = sin(x)',
            snippet: 'xAxisNumbers: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'yAxisNumbers',
            detail: 'Show numbers on y-axis [default: true]',
            example: 'config { yAxisNumbers: false }\ny = sin(x)',
            snippet: 'yAxisNumbers: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'polarMode',
            detail: 'Use polar coordinates [default: false]',
            example: 'config { polarMode: true }\nr = 2 + sin(3theta)',
            snippet: 'polarMode: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'lockViewport',
            detail: 'Lock viewport from panning/zooming [default: false]',
            example: 'config { lockViewport: true }\ny = sin(x)',
            snippet: 'lockViewport: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'xmin',
            detail: 'Left edge of the viewport [default: -10]',
            example: 'config { xmin: -2; xmax: 2 }\ny = x ^ 3',
            snippet: 'xmin: ${1:-10}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'xmax',
            detail: 'Right edge of the viewport [default: 10]',
            example: 'config { xmin: -2; xmax: 2 }\ny = x ^ 3',
            snippet: 'xmax: ${1:10}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'ymin',
            detail: 'Bottom edge of the viewport [default: fits the aspect ratio]',
            example: 'config { ymin: -1; ymax: 8 }\ny = x ^ 2',
            snippet: 'ymin: ${1:-10}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'ymax',
            detail: 'Top edge of the viewport [default: fits the aspect ratio]',
            example: 'config { ymin: -1; ymax: 8 }\ny = x ^ 2',
            snippet: 'ymax: ${1:10}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'squareAxes',
            detail: 'Keep one x unit the same length as one y unit [default: true]',
            example: 'config { squareAxes: false; ymin: -1; ymax: 1 }\ny = sin(x)',
            valueType: 'boolean',
            appliesTo: ['config'],
            snippet: 'squareAxes: ${1|true,false|}',
        },
        {
            name: 'userLockedViewport',
            detail: "Lock the viewport the way the graph's own settings menu does, so nobody can pan or zoom [default: false]",
            example: 'config { userLockedViewport: true }\ny = sin(x)',
            valueType: 'boolean',
            appliesTo: ['config'],
            snippet: 'userLockedViewport: ${1|true,false|}',
        },
        {
            name: 'expressionsCollapsed',
            detail: 'Collapse expressions list [default: true]',
            example: 'config { expressionsCollapsed: false }\ny = sin(x)',
            snippet: 'expressionsCollapsed: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'capExpressionSize',
            detail: 'Limit expression complexity [default: true]',
            example: 'config { capExpressionSize: false }\ny = sin(x)',
            snippet: 'capExpressionSize: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'pointsOfInterest',
            detail: 'Show points of interest [default: true]',
            example: 'config { pointsOfInterest: false }\ny = sin(x)',
            snippet: 'pointsOfInterest: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'trace',
            detail: 'Enable trace mode [default: false]',
            example: 'config { trace: false }\ny = sin(x)',
            snippet: 'trace: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'border',
            detail: 'Show calculator border [default: false]',
            example: 'config { border: true }\ny = sin(x)',
            snippet: 'border: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'keypad',
            detail: 'Show on-screen keypad [default: true]',
            example: 'config { keypad: false }\ny = sin(x)',
            snippet: 'keypad: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'graphpaper',
            detail: 'Show graph paper background [default: true]',
            example: 'config { graphpaper: true }\ny = sin(x)',
            snippet: 'graphpaper: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'calculus',
            detail: 'Allow derivatives and integrals [default: true] (Desmos v1.12)',
            example: 'config { calculus: false }\ny = sin(x)',
            snippet: 'calculus: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'clearIntoDegreeMode',
            detail: 'Clearing the graph keeps degree mode [default: matches degreeMode] (Desmos v1.12)',
            example: 'config { clearIntoDegreeMode: true }\ny = sin(x)',
            snippet: 'clearIntoDegreeMode: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'invertedColors',
            detail: 'Invert every displayed color [default: false]',
            example: 'config { invertedColors: true }\ny = sin(x)',
            snippet: 'invertedColors: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'invertedColorsControl',
            detail: 'Show the "Reverse Contrast" checkbox [default: true] (Desmos v1.12)',
            example: 'config { invertedColorsControl: false }\ny = sin(x)',
            snippet: 'invertedColorsControl: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'backgroundColor',
            detail: 'Calculator background colour, #hex or a palette name [beta, Desmos v1.12]',
            documentation:
                'A hex literal or a palette name only: Desmos wants a hex string here, not an expression.',
            example: 'config { backgroundColor: #1e1e2e }\ny = sin(x)',
            snippet: 'backgroundColor: ${1:#fff}',
            valueType: 'color',
            appliesTo: ['config'],
        },
        {
            name: 'textColor',
            detail: 'Calculator text colour, #hex or a palette name [beta, Desmos v1.12]',
            documentation:
                'A hex literal or a palette name only: Desmos wants a hex string here, not an expression.',
            example: 'config { textColor: #444444 }\ny = sin(x)',
            snippet: 'textColor: ${1:#000}',
            valueType: 'color',
            appliesTo: ['config'],
        },
        {
            name: 'accentColor',
            detail: 'Accent colour for buttons and focus outlines, #hex or a palette name [beta, Desmos v1.12]',
            documentation:
                'A hex literal or a palette name only: Desmos wants a hex string here, not an expression.',
            example: 'config { accentColor: PURPLE }\ny = sin(x)',
            snippet: 'accentColor: ${1:#2f72dc}',
            valueType: 'color',
            appliesTo: ['config'],
        },
        {
            name: 'showReducedMotionCover',
            detail: 'Pause animations for prefers-reduced-motion [default: false]',
            example: 'config { showReducedMotionCover: true }\ny = sin(x)',
            snippet: 'showReducedMotionCover: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'projectorMode',
            detail: 'Larger fonts and thicker lines [default: false]',
            example: 'config { projectorMode: true }\ny = sin(x)',
            snippet: 'projectorMode: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'zoomFit',
            detail: 'Allow expressions to specify a viewport [default: true]',
            example: 'config { zoomFit: false }\ny = sin(x)',
            snippet: 'zoomFit: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'xAxisLabel',
            detail: 'Label for the x-axis [default: empty]',
            example: 'config { xAxisLabel: "time"; yAxisLabel: "height" }\ny = sin(x)',
            snippet: 'xAxisLabel: "${1:}"',
            valueType: 'string',
            appliesTo: ['config'],
        },
        {
            name: 'yAxisLabel',
            detail: 'Label for the y-axis [default: empty]',
            example: 'config { xAxisLabel: "time"; yAxisLabel: "height" }\ny = sin(x)',
            snippet: 'yAxisLabel: "${1:}"',
            valueType: 'string',
            appliesTo: ['config'],
        },
        {
            name: 'xAxisScale',
            detail: 'x-axis scale [default: linear]',
            documentation:
                'Needs `logScales`, which is on by default: with it off, the scale is linear whatever this says.',
            example: 'config { xAxisScale: logarithmic; xmin: 0.1; xmax: 1000 }\ny = log(x)',
            snippet: 'xAxisScale: ${1|linear,logarithmic|}',
            valueType: 'enum',
            values: ['linear', 'logarithmic'],
            appliesTo: ['config'],
        },
        {
            name: 'yAxisScale',
            detail: 'y-axis scale [default: linear]',
            documentation:
                'Needs `logScales`, which is on by default: with it off, the scale is linear whatever this says.',
            example: 'config { yAxisScale: logarithmic; ymin: 0.1; ymax: 1000 }\ny = 2 ^ x',
            snippet: 'yAxisScale: ${1|linear,logarithmic|}',
            valueType: 'enum',
            values: ['linear', 'logarithmic'],
            appliesTo: ['config'],
        },
        {
            name: 'randomSeed',
            detail: 'Seed for random() [default: generated]',
            documentation: 'The same seed gives the same numbers every time the graph opens.',
            example: 'config { randomSeed: "axis" }\nL = random(5)',
            snippet: 'randomSeed: "${1:}"',
            valueType: 'string',
            appliesTo: ['config'],
        },
        {
            name: 'includeFunctionParametersInRandomSeed',
            detail: "Vary random() by a function's arguments [default: true]",
            example:
                'config { includeFunctionParametersInRandomSeed: false }\nf(a) = random()\nb = f(1)',
            snippet: 'includeFunctionParametersInRandomSeed: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'fontSize',
            detail: 'Base font size [default: 16]',
            example: 'config { fontSize: 20 }\ny = sin(x)',
            snippet: 'fontSize: ${1:16}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'language',
            detail: 'UI language [default: en]',
            example: 'config { language: "fr" }\ny = sin(x)',
            snippet: 'language: "${1:en}"',
            valueType: 'string',
            appliesTo: ['config'],
        },

        // Behaviour toggles
        {
            name: 'expressions',
            detail: 'Show the expressions list [default: true]',
            example: 'config { expressions: false }\ny = sin(x)',
            snippet: 'expressions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'expressionsTopbar',
            detail: 'Show the toolbar above the expressions list [default: true]',
            example: 'config { expressionsTopbar: false }\ny = sin(x)',
            snippet: 'expressionsTopbar: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'zoomButtons',
            detail: 'Show the zoom buttons [default: false]',
            example: 'config { zoomButtons: true }\ny = sin(x)',
            snippet: 'zoomButtons: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'keypadActivated',
            detail: 'Open the keypad on load [default: false]',
            example: 'config { keypadActivated: true }\ny = sin(x)',
            snippet: 'keypadActivated: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showResetButtonOnGraphpaper',
            detail: 'Show a reset button on the graph paper [default: false]',
            example: 'config { showResetButtonOnGraphpaper: true }\ny = sin(x)',
            snippet: 'showResetButtonOnGraphpaper: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'settingsMenu',
            detail: 'Show the graph settings menu [default: false]',
            example: 'config { settingsMenu: true }\ny = sin(x)',
            snippet: 'settingsMenu: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'authorFeatures',
            detail: 'Enable author features such as secret folders [default: false]',
            example: 'config { authorFeatures: true }\nk = 3 @ secret\ny = k sin(x)',
            snippet: 'authorFeatures: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'administerSecretFolders',
            detail: 'Reveal the contents of secret folders [default: false]',
            example: 'config { administerSecretFolders: true }\nk = 3 @ secret\ny = k sin(x)',
            snippet: 'administerSecretFolders: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'images',
            detail: 'Allow images [default: true]',
            example: 'config { images: false }\ny = sin(x)',
            snippet: 'images: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'folders',
            detail: 'Allow folders [default: true]',
            example: 'config { folders: false }\ny = sin(x)',
            snippet: 'folders: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'notes',
            detail: 'Allow notes [default: true]',
            example: 'config { notes: false }\ny = sin(x)',
            snippet: 'notes: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'sliders',
            detail: 'Allow sliders [default: true]',
            example: 'config { sliders: false }\ny = sin(x)',
            snippet: 'sliders: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'substitutions',
            detail: 'Allow "with" substitutions [default: true]',
            example: 'config { substitutions: true }\ny = a x ^ 2 with a = 0.5',
            snippet: 'substitutions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'qwertyKeyboard',
            detail: 'Show the QWERTY keyboard on the keypad [default: true]',
            example: 'config { qwertyKeyboard: false }\ny = sin(x)',
            snippet: 'qwertyKeyboard: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'distributions',
            detail: 'Allow statistical distributions [default: true]',
            example: 'config { distributions: false }\ny = sin(x)',
            snippet: 'distributions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'restrictedFunctions',
            detail: 'Limit the available functions to a basic set [default: false]',
            example: 'config { restrictedFunctions: true }\ny = sin(x)',
            snippet: 'restrictedFunctions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'forceEnableGeometryFunctions',
            detail: 'Enable geometry functions [default: false]',
            example: 'config { forceEnableGeometryFunctions: true }\ny = sin(x)',
            snippet: 'forceEnableGeometryFunctions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'pasteGraphLink',
            detail: 'Allow pasting a graph link to import it [default: false]',
            example: 'config { pasteGraphLink: true }\ny = sin(x)',
            snippet: 'pasteGraphLink: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'pasteTableData',
            detail: 'Allow pasting tabular data into a table [default: true]',
            example: 'config { pasteTableData: false }\ny = sin(x)',
            snippet: 'pasteTableData: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'autosize',
            detail: 'Resize the calculator with its container [default: true]',
            example: 'config { autosize: false }\ny = sin(x)',
            snippet: 'autosize: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'plotInequalities',
            detail: 'Shade inequalities [default: true]',
            example: 'config { plotInequalities: false }\ny = sin(x)',
            snippet: 'plotInequalities: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'plotImplicits',
            detail: 'Plot implicit equations and inequalities [default: true]',
            example: 'config { plotImplicits: false }\ny = sin(x)',
            snippet: 'plotImplicits: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'plotSingleVariableImplicitEquations',
            detail: 'Plot single-variable implicit equations [default: true]',
            example: 'config { plotSingleVariableImplicitEquations: false }\ny = sin(x)',
            snippet: 'plotSingleVariableImplicitEquations: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'brailleControls',
            detail: 'Show braille controls [default: true]',
            example: 'config { brailleControls: false }\ny = sin(x)',
            snippet: 'brailleControls: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'audio',
            detail: 'Enable audio trace [default: true]',
            example: 'config { audio: false }\ny = sin(x)',
            snippet: 'audio: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'tone',
            detail: 'Allow the tone() function [default: true]',
            example: 'config { tone: false }\ny = sin(x)',
            snippet: 'tone: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'muted',
            detail: 'Mute audio output [default: false]',
            example: 'config { muted: true }\ny = sin(x)',
            snippet: 'muted: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'forceLogModeRegressions',
            detail: 'Force regressions into log mode [default: false]',
            example: 'config { forceLogModeRegressions: true }\ny = sin(x)',
            snippet: 'forceLogModeRegressions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'defaultLogModeRegressions',
            detail: 'Default new regressions to log mode [default: false]',
            example: 'config { defaultLogModeRegressions: true }\ny = sin(x)',
            snippet: 'defaultLogModeRegressions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'customRegressions',
            detail: 'Allow custom regressions [default: true]',
            example: 'config { customRegressions: false }\ny = sin(x)',
            snippet: 'customRegressions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'regressionTemplates',
            detail: 'Offer regression templates [default: true]',
            example: 'config { regressionTemplates: false }\ny = sin(x)',
            snippet: 'regressionTemplates: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'logScales',
            detail: 'Allow logarithmic axis scales [default: true]',
            example: 'config { logScales: false }\ny = sin(x)',
            snippet: 'logScales: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'intervalComprehensions',
            detail: 'Allow interval comprehensions [default: true]',
            example: 'config { intervalComprehensions: false }\ny = sin(x)',
            snippet: 'intervalComprehensions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'allowComplex',
            detail: 'Put the graph in complex mode [default: false]',
            documentation:
                'In complex mode `i` is the imaginary unit, `sqrt(-1)` is `i` rather than undefined, a complex number is drawn as a point, and `real`, `imag`, `conj` and `arg` exist.',
            example: 'config { allowComplex: true }\nz = 3 + 4i\nw = conj(z)',
            snippet: 'allowComplex: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'recursion',
            detail: 'Allow recursive definitions [default: false]',
            example: 'config { recursion: true }\nf(n) = {n <= 1: 1, n f(n - 1)}\na = f(5)',
            snippet: 'recursion: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showEvaluationCopyButtons',
            detail: 'Show copy buttons beside evaluations [default: false]',
            example: 'config { showEvaluationCopyButtons: true }\na = 2 ^ 10',
            snippet: 'showEvaluationCopyButtons: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'decimalToFraction',
            detail: 'Offer decimal/fraction toggling [default: true]',
            example: 'config { decimalToFraction: false }\na = 1 / 3',
            snippet: 'decimalToFraction: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'sixKeyInput',
            detail: 'Enable six-key braille input [default: false]',
            example: 'config { sixKeyInput: true }\ny = sin(x)',
            snippet: 'sixKeyInput: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'polarNumbers',
            detail: 'Show numbers on the polar grid [default: true]',
            example: 'config { polarMode: true; polarNumbers: false }\nr = 2',
            snippet: 'polarNumbers: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },

        // Axis scaling
        {
            name: 'xAxisStep',
            detail: 'Spacing between x-axis labels, 0 for automatic [default: 0]',
            example: 'config { xAxisStep: 3.14159 }\ny = sin(x)',
            snippet: 'xAxisStep: ${1:0}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'yAxisStep',
            detail: 'Spacing between y-axis labels, 0 for automatic [default: 0]',
            example: 'config { yAxisStep: 0.5 }\ny = sin(x)',
            snippet: 'yAxisStep: ${1:0}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'xAxisMinorSubdivisions',
            detail: 'Minor grid lines per x-axis step, 0 for automatic [default: 0]',
            example: 'config { xAxisMinorSubdivisions: 2 }\ny = sin(x)',
            snippet: 'xAxisMinorSubdivisions: ${1:0}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'yAxisMinorSubdivisions',
            detail: 'Minor grid lines per y-axis step, 0 for automatic [default: 0]',
            example: 'config { yAxisMinorSubdivisions: 2 }\ny = sin(x)',
            snippet: 'yAxisMinorSubdivisions: ${1:0}',
            valueType: 'number',
            appliesTo: ['config'],
        },

        // Enumerated settings
        {
            name: 'xAxisArrowMode',
            detail: 'Arrowheads on the x-axis [default: NONE]',
            example: 'config { xAxisArrowMode: POSITIVE }\ny = sin(x)',
            snippet: 'xAxisArrowMode: ${1|NONE,POSITIVE,BOTH|}',
            valueType: 'enum',
            values: ['NONE', 'POSITIVE', 'BOTH'],
            appliesTo: ['config'],
        },
        {
            name: 'yAxisArrowMode',
            detail: 'Arrowheads on the y-axis [default: NONE]',
            example: 'config { yAxisArrowMode: BOTH }\ny = sin(x)',
            snippet: 'yAxisArrowMode: ${1|NONE,POSITIVE,BOTH|}',
            valueType: 'enum',
            values: ['NONE', 'POSITIVE', 'BOTH'],
            appliesTo: ['config'],
        },
        {
            name: 'actions',
            detail: 'Allow action expressions [default: auto]',
            documentation:
                '`auto` decides from the expression list, which cannot see a ticker - so the compiler switches actions on for any file with one.',
            example: 'config { actions: true }\nn = 0\nticker n -> n + 1 @ playing',
            snippet: 'actions: ${1|true,false,auto|}',
            valueType: 'enum',
            values: ['true', 'false', 'auto'],
            appliesTo: ['config'],
        },
        {
            name: 'reportPosition',
            detail: 'Position readout for screen readers [default: default]',
            example: 'config { reportPosition: coordinates }\ny = sin(x)',
            snippet: 'reportPosition: ${1|default,coordinates,percents|}',
            valueType: 'enum',
            values: ['default', 'coordinates', 'percents'],
            appliesTo: ['config'],
        },
        {
            name: 'brailleMode',
            detail: 'Braille code [default: none]',
            example: 'config { brailleMode: nemeth }\ny = sin(x)',
            snippet: 'brailleMode: ${1|none,nemeth,ueb|}',
            valueType: 'enum',
            values: ['none', 'nemeth', 'ueb'],
            appliesTo: ['config'],
        },
        {
            name: 'graphDescription',
            detail: 'Screen-reader description of the whole graph [default: empty]',
            example: 'config { graphDescription: "One period of a sine wave" }\ny = sin(x)',
            snippet: 'graphDescription: "${1:}"',
            valueType: 'string',
            appliesTo: ['config'],
        },
    ] satisfies PropertyDefinition[],
};

// ─────────────────────────────────────────────────────────────────────────────
// Derived lookups
// ─────────────────────────────────────────────────────────────────────────────

/** Every built-in function name, longest first so `arcsin` beats `arc`. */
export const AXIS_FUNCTION_NAMES: readonly string[] = AXIS_MANIFEST.functions
    .map(fn => fn.name)
    .sort((a, b) => b.length - a.length);

/** Every bare operator name, longest first for the same reason. */
export const AXIS_OPERATOR_NAMES: readonly string[] = AXIS_MANIFEST.operators
    .map(operator => operator.name)
    .sort((a, b) => b.length - a.length);

/** Every built-in constant name, longest first so `alpha` beats `a`. */
export const AXIS_CONSTANT_NAMES: readonly string[] = AXIS_MANIFEST.constants
    .map(constant => constant.name)
    .sort((a, b) => b.length - a.length);

/** The same three, as sets, for the checker's "is this name built in?" */
export const AXIS_FUNCTION_NAME_SET: ReadonlySet<string> = new Set(AXIS_FUNCTION_NAMES);
export const AXIS_OPERATOR_NAME_SET: ReadonlySet<string> = new Set(AXIS_OPERATOR_NAMES);
export const AXIS_CONSTANT_NAME_SET: ReadonlySet<string> = new Set(AXIS_CONSTANT_NAMES);

/** The functions Desmos knows only in complex mode (spec §5.3). */
export const AXIS_COMPLEX_FUNCTION_NAMES: ReadonlySet<string> = new Set(
    AXIS_MANIFEST.functions.filter(fn => fn.complex).map(fn => fn.name),
);

/** Every name the language defines in expressions: functions, operators and constants. */
export const AXIS_BUILTIN_NAMES: ReadonlySet<string> = new Set([
    ...AXIS_FUNCTION_NAMES,
    ...AXIS_OPERATOR_NAMES,
    ...AXIS_CONSTANT_NAMES,
]);

export const AXIS_METADATA_PROPERTY_NAMES: readonly string[] = AXIS_MANIFEST.metadata.map(
    property => property.name,
);

export const AXIS_CONFIG_PROPERTY_NAMES: readonly string[] = AXIS_MANIFEST.configProperties.map(
    property => property.name,
);

export const AXIS_TICKER_PROPERTY_NAMES: readonly string[] = AXIS_MANIFEST.tickerProperties.map(
    property => property.name,
);

/** Every property the manifest defines, wherever it goes. */
export const AXIS_PROPERTIES: readonly PropertyDefinition[] = [
    ...AXIS_MANIFEST.metadata,
    ...AXIS_MANIFEST.tickerProperties,
    ...AXIS_MANIFEST.configProperties,
];

/** Every property name, for a spell check that does not yet know where it is. */
export const AXIS_PROPERTY_NAMES: ReadonlySet<string> = new Set(
    AXIS_PROPERTIES.map(property => property.name),
);

const PROPERTIES_BY_PLACEMENT: ReadonlyMap<
    PropertyPlacement,
    ReadonlyMap<string, PropertyDefinition>
> = new Map(
    AXIS_PROPERTY_PLACEMENTS.map(placement => [
        placement,
        new Map(
            AXIS_PROPERTIES.filter(property => property.appliesTo.includes(placement)).map(
                property => [property.name, property] as const,
            ),
        ),
    ]),
);

/** The properties legal in one place, in manifest order. */
export function propertiesFor(placement: PropertyPlacement): readonly PropertyDefinition[] {
    return [...(PROPERTIES_BY_PLACEMENT.get(placement)?.values() ?? [])];
}

/**
 * A property by name. With a placement, only the definition legal there - which
 * matters for `playing`, a slider's on an expression and the ticker's own on a
 * ticker. Without one, the first definition of the name anywhere.
 */
export function findProperty(
    name: string,
    placement?: PropertyPlacement,
): PropertyDefinition | undefined {
    if (placement) return PROPERTIES_BY_PLACEMENT.get(placement)?.get(name);
    return AXIS_PROPERTIES.find(property => property.name === name);
}

/**
 * Everywhere a property is legal, for a diagnostic that says where it belongs:
 * "`collapsed` goes on a folder or an import".
 */
export function placementsOf(name: string): PropertyPlacement[] {
    return AXIS_PROPERTY_PLACEMENTS.filter(placement =>
        PROPERTIES_BY_PLACEMENT.get(placement)?.has(name),
    );
}

/**
 * The canonical spelling of an enum value, or undefined if the property has no
 * such value.
 *
 * Enums are case-insensitive in source - `dragMode: none` and `lineStyle:
 * dashed` are fine - but Desmos is not: it wants `NONE` and `DASHED`, and
 * `above` rather than `ABOVE`, and ignores anything else in silence. So the
 * manifest lists the spellings Desmos uses, and this is how a written value
 * is matched to one.
 */
export function enumValue(property: PropertyDefinition, written: string): string | undefined {
    const lower = written.toLowerCase();
    return property.values?.find(value => value.toLowerCase() === lower);
}

/**
 * The colours Desmos names, with the hex `Desmos.Colors` gives each. `color:
 * RED` sets `color` to that hex; any other identifier is an expression and
 * sets `colorLatex` (spec §4.3).
 */
export const AXIS_PALETTE: readonly PaletteColor[] = [
    { name: 'RED', hex: '#c74440' },
    { name: 'BLUE', hex: '#2d70b3' },
    { name: 'GREEN', hex: '#388c46' },
    { name: 'PURPLE', hex: '#6042a6' },
    { name: 'ORANGE', hex: '#fa7e19' },
    { name: 'BLACK', hex: '#000000' },
];

/** Palette name to hex. */
export const AXIS_PALETTE_HEX: ReadonlyMap<string, string> = new Map(
    AXIS_PALETTE.map(color => [color.name, color.hex]),
);

/**
 * The `config { … }` keys that describe the *graph* rather than the calculator
 * around it, and so cannot be applied with `updateSettings`.
 *
 * Desmos keeps the viewport in the graph state, not in the calculator options:
 * `updateSettings({ xmin: 0 })` is silently ignored, and the bounds only move
 * through `setState` or `setMathBounds`. The compiler separates them out for
 * that reason, and every host that applies a compilation has to apply them the
 * other way — so the list lives here rather than in each of them.
 */
export const AXIS_VIEWPORT_PROPERTY_NAMES = ['xmin', 'xmax', 'ymin', 'ymax'] as const;

/** Graph-state config keys that are not part of the viewport rectangle. */
export const AXIS_GRAPH_PROPERTY_NAMES = ['squareAxes', 'userLockedViewport'] as const;

/**
 * The Desmos product each `calculator:` value names, which the compiler writes
 * as the state's `graph.product`. `GRAPHING` names none: the graphing
 * calculator writes no product into a state of its own, so a file that says
 * nothing compiles to the same state it always has.
 */
export const AXIS_CALCULATOR_PRODUCTS: Readonly<Record<string, string | undefined>> = {
    GRAPHING: undefined,
    GEOMETRY: 'geometry-calculator',
    GRAPHING_3D: 'graphing-3d',
};

/**
 * The config keys Desmos reads off the *top* of a graph state, outside `graph`.
 *
 * A narrower case than {@link AXIS_GRAPH_PROPERTY_NAMES}: those go into the
 * state's `graph` object, these sit beside it. Desmos accepts them nowhere else
 * — not through `updateSettings`, not as a calculator option, not inside
 * `graph` — and ignores them in silence when they are put in the wrong place,
 * so a host that renders a compilation has to apply this third part too.
 */
export const AXIS_STATE_PROPERTY_NAMES = ['includeFunctionParametersInRandomSeed'] as const;

/**
 * The {@link AXIS_STATE_PROPERTY_NAMES} defaults, for a file that says
 * nothing. Separate from {@link AXIS_DEFAULT_CONFIG} because these go somewhere
 * else entirely — that one is calculator options, this one is graph state.
 *
 * Desmos reads a state with no `includeFunctionParametersInRandomSeed` as the
 * legacy randomization behaviour, under which `random()` and `shuffle` inside a
 * function return the same draw for every argument. A graph made at desmos.com
 * today is migrated off that, so a file written today starts off it too — and
 * a legacy graph being decompiled has to say `false` to keep what it had.
 */
export const AXIS_DEFAULT_STATE: Readonly<Record<string, boolean>> = {
    includeFunctionParametersInRandomSeed: true,
};

/**
 * The calculator options Axis applies when a file does not say otherwise.
 *
 * Desmos's own defaults are those of the full editor at desmos.com - the
 * expression list open beside the graph, the settings menu, the zoom buttons
 * and a border around the lot. A compiled Axis file is a *finished* graph
 * rather than something to be edited in place, so it wants the picture: the
 * chrome is off and the expression list starts collapsed, there to be opened
 * by anyone who wants to read the maths but not in the way of the graph.
 * Anything a file writes in its own `config { … }` still wins, so
 * `expressionsCollapsed: false` opens the list on load.
 */
export const AXIS_DEFAULT_CONFIG: Readonly<Record<string, boolean>> = {
    border: false,
    expressions: true,
    expressionsCollapsed: true,
    settingsMenu: false,
    zoomButtons: false,
};

const LATEX_FOR_FUNCTION = new Map(AXIS_MANIFEST.functions.map(fn => [fn.name, fn.latex]));

/**
 * The LaTeX for each constant that has one, longest name first.
 *
 * Not every constant does: Desmos writes `e`, `true` and `false` as themselves,
 * and substituting `\\e` for them would produce a command that does not exist.
 * Those declare `latex: null` and are absent here, so the compiler leaves them
 * alone while completions still offer them.
 */
export const AXIS_LATEX_FOR_CONSTANT: ReadonlyMap<string, string> = new Map(
    AXIS_MANIFEST.constants
        .filter(constant => constant.latex !== null)
        .map(constant => [constant.name, constant.latex ?? `\\${constant.name}`] as const)
        .sort(([a], [b]) => b.length - a.length),
);

/**
 * The LaTeX a built-in function compiles to. Desmos writes multi-letter
 * functions as `\operatorname{name}`; only true LaTeX commands (`\sin`,
 * `\ln`, …) are emitted bare, and those declare `latex` in the manifest.
 */
export function getFunctionLatex(name: string): string {
    return LATEX_FOR_FUNCTION.get(name) ?? `\\operatorname{${name}}`;
}
