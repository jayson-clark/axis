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
// The lookups below are derived once at module load: the compiler consults them
// per expression, which on a live preview means per keystroke.

import { KEYWORDS } from './tokens';

/** A built-in function, as offered in completions and emitted as LaTeX. */
export interface FunctionDefinition {
    name: string;
    detail: string;
    snippet?: string;
    category:
        'trig' | 'math' | 'list' | 'color' | 'statistics' | 'combinatorics' | 'geometry' | 'audio';
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
    category: 'viewport' | 'list' | 'scope' | 'ticker';
}

/** A built-in constant: a Greek letter, a mathematical constant, a boolean. */
export interface ConstantDefinition {
    name: string;
    detail: string;
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
            snippet: 'sin(${1:x})',
            category: 'trig',
            latex: '\\sin',
        },
        {
            name: 'cos',
            detail: 'Cosine function',
            snippet: 'cos(${1:x})',
            category: 'trig',
            latex: '\\cos',
        },
        {
            name: 'tan',
            detail: 'Tangent function',
            snippet: 'tan(${1:x})',
            category: 'trig',
            latex: '\\tan',
        },
        {
            name: 'csc',
            detail: 'Cosecant function',
            snippet: 'csc(${1:x})',
            category: 'trig',
            latex: '\\csc',
        },
        {
            name: 'sec',
            detail: 'Secant function',
            snippet: 'sec(${1:x})',
            category: 'trig',
            latex: '\\sec',
        },
        {
            name: 'cot',
            detail: 'Cotangent function',
            snippet: 'cot(${1:x})',
            category: 'trig',
            latex: '\\cot',
        },
        {
            name: 'arcsin',
            detail: 'Arcsine function',
            snippet: 'arcsin(${1:x})',
            category: 'trig',
            latex: '\\arcsin',
        },
        {
            name: 'arccos',
            detail: 'Arccosine function',
            snippet: 'arccos(${1:x})',
            category: 'trig',
            latex: '\\arccos',
        },
        {
            name: 'arctan',
            detail: 'Arctangent function',
            snippet: 'arctan(${1:x})',
            category: 'trig',
            latex: '\\arctan',
        },
        {
            name: 'arccsc',
            detail: 'Arccosecant function',
            snippet: 'arccsc(${1:x})',
            category: 'trig',
        },
        {
            name: 'arcsec',
            detail: 'Arcsecant function',
            snippet: 'arcsec(${1:x})',
            category: 'trig',
        },
        {
            name: 'arccot',
            detail: 'Arccotangent function',
            snippet: 'arccot(${1:x})',
            category: 'trig',
        },
        {
            name: 'sinh',
            detail: 'Hyperbolic sine',
            snippet: 'sinh(${1:x})',
            category: 'trig',
            latex: '\\sinh',
        },
        {
            name: 'cosh',
            detail: 'Hyperbolic cosine',
            snippet: 'cosh(${1:x})',
            category: 'trig',
            latex: '\\cosh',
        },
        {
            name: 'tanh',
            detail: 'Hyperbolic tangent',
            snippet: 'tanh(${1:x})',
            category: 'trig',
            latex: '\\tanh',
        },
        { name: 'csch', detail: 'Hyperbolic cosecant', snippet: 'csch(${1:x})', category: 'trig' },
        { name: 'sech', detail: 'Hyperbolic secant', snippet: 'sech(${1:x})', category: 'trig' },
        {
            name: 'coth',
            detail: 'Hyperbolic cotangent',
            snippet: 'coth(${1:x})',
            category: 'trig',
            latex: '\\coth',
        },

        // Mathematical functions
        { name: 'sqrt', detail: 'Square root', snippet: 'sqrt(${1:x})', category: 'math' },
        {
            name: 'nthroot',
            detail: 'Nth root',
            snippet: 'nthroot(${1:x}, ${2:n})',
            category: 'math',
        },
        { name: 'abs', detail: 'Absolute value', snippet: 'abs(${1:x})', category: 'math' },
        {
            name: 'ln',
            detail: 'Natural logarithm',
            snippet: 'ln(${1:x})',
            category: 'math',
            latex: '\\ln',
        },
        {
            name: 'log',
            detail: 'Logarithm base 10',
            snippet: 'log(${1:x})',
            category: 'math',
            latex: '\\log',
        },
        {
            name: 'exp',
            detail: 'Exponential (e^x)',
            snippet: 'exp(${1:x})',
            category: 'math',
            latex: '\\exp',
        },
        { name: 'floor', detail: 'Floor function', snippet: 'floor(${1:x})', category: 'math' },
        { name: 'ceil', detail: 'Ceiling function', snippet: 'ceil(${1:x})', category: 'math' },
        { name: 'round', detail: 'Round function', snippet: 'round(${1:x})', category: 'math' },
        { name: 'sign', detail: 'Sign function', snippet: 'sign(${1:x})', category: 'math' },
        // Desmos accepts `sign` and writes `sgn` back, so both are names Axis
        // has to know: the one an author types and the one a graph read off
        // desmos.com arrives spelled with.
        { name: 'sgn', detail: 'Sign function', snippet: 'sgn(${1:x})', category: 'math' },
        { name: 'mod', detail: 'Modulo', snippet: 'mod(${1:x}, ${2:y})', category: 'math' },
        {
            name: 'gcd',
            detail: 'Greatest common divisor',
            snippet: 'gcd(${1:x}, ${2:y})',
            category: 'math',
            latex: '\\gcd',
        },
        {
            name: 'lcm',
            detail: 'Least common multiple',
            snippet: 'lcm(${1:x}, ${2:y})',
            category: 'math',
        },

        // Statistical functions
        {
            name: 'total',
            detail: 'Sum of list',
            snippet: 'total(${1:list})',
            category: 'statistics',
        },
        {
            name: 'length',
            detail: 'Length of list',
            snippet: 'length(${1:list})',
            category: 'statistics',
        },
        {
            name: 'count',
            detail: 'Number of elements in a list; also written `list.count`',
            snippet: 'count(${1:list})',
            category: 'statistics',
        },
        {
            name: 'mean',
            detail: 'Mean of list',
            snippet: 'mean(${1:list})',
            category: 'statistics',
        },
        {
            name: 'median',
            detail: 'Median of list',
            snippet: 'median(${1:list})',
            category: 'statistics',
        },
        {
            name: 'min',
            detail: 'Minimum of list',
            snippet: 'min(${1:list})',
            category: 'statistics',
            latex: '\\min',
        },
        {
            name: 'max',
            detail: 'Maximum of list',
            snippet: 'max(${1:list})',
            category: 'statistics',
            latex: '\\max',
        },
        {
            name: 'stdev',
            detail: 'Standard deviation',
            snippet: 'stdev(${1:list})',
            category: 'statistics',
        },
        {
            name: 'stdevp',
            detail: 'Population standard deviation',
            snippet: 'stdevp(${1:list})',
            category: 'statistics',
        },
        {
            name: 'mad',
            detail: 'Mean absolute deviation',
            snippet: 'mad(${1:list})',
            category: 'statistics',
        },
        { name: 'var', detail: 'Variance', snippet: 'var(${1:list})', category: 'statistics' },
        {
            name: 'varp',
            detail: 'Population variance',
            snippet: 'varp(${1:list})',
            category: 'statistics',
        },
        {
            name: 'discretedist',
            detail: 'Discrete distribution over values with optional weights (new in Desmos v1.12)',
            snippet: 'discretedist(${1:values}, ${2:weights})',
            category: 'statistics',
        },
        {
            name: 'random',
            detail: 'Random number in [0, 1); random(n) gives a list of n, random(list) shuffles it',
            snippet: 'random(${1:})',
            category: 'statistics',
        },

        // List generation
        {
            name: 'repeat',
            detail: 'Repeat a value or list n times (new in Desmos v1.12)',
            snippet: 'repeat(${1:value}, ${2:n})',
            category: 'list',
        },
        {
            name: 'join',
            detail: 'Concatenate lists or values into one list',
            snippet: 'join(${1:a}, ${2:b})',
            category: 'list',
        },
        {
            name: 'sort',
            detail: 'Sort a list, optionally by a second list',
            snippet: 'sort(${1:list})',
            category: 'list',
        },
        {
            name: 'unique',
            detail: 'The distinct values of a list, in the order they first appear',
            snippet: 'unique(${1:list})',
            category: 'list',
        },
        {
            name: 'shuffle',
            detail: 'A list in random order',
            snippet: 'shuffle(${1:list})',
            category: 'list',
        },

        // Geometry — take points, not numbers
        {
            name: 'polygon',
            detail: 'Polygon from points or a point list',
            snippet: 'polygon(${1:points})',
            category: 'geometry',
        },
        {
            name: 'polygonGlider',
            detail: "The point a fraction of the way around a polygon's perimeter",
            snippet: 'polygonGlider(${1:polygon}, ${2:t})',
            category: 'geometry',
        },
        {
            name: 'polygonInteriorDirectedAngles',
            detail: 'The signed interior angles of a polygon',
            snippet: 'polygonInteriorDirectedAngles(${1:polygon}, ${2:n})',
            category: 'geometry',
        },
        {
            name: 'distance',
            detail: 'Distance between two points',
            snippet: 'distance(${1:A}, ${2:B})',
            category: 'geometry',
        },
        {
            name: 'midpoint',
            detail: 'Midpoint of two points',
            snippet: 'midpoint(${1:A}, ${2:B})',
            category: 'geometry',
        },

        // Color functions — ok* spaces are perceptually uniform (new in Desmos v1.12)
        {
            name: 'rgb',
            detail: 'Color from red, green, blue (0-255)',
            snippet: 'rgb(${1:r}, ${2:g}, ${3:b})',
            category: 'color',
        },
        {
            name: 'hsv',
            detail: 'Color from hue, saturation, value',
            snippet: 'hsv(${1:h}, ${2:s}, ${3:v})',
            category: 'color',
        },
        {
            name: 'okhsv',
            detail: 'Perceptually uniform color from hue, saturation, value (new in Desmos v1.12)',
            snippet: 'okhsv(${1:h}, ${2:s}, ${3:v})',
            category: 'color',
        },
        {
            name: 'oklab',
            detail: 'Perceptually uniform color from lightness, a, b (new in Desmos v1.12)',
            snippet: 'oklab(${1:l}, ${2:a}, ${3:b})',
            category: 'color',
        },
        {
            name: 'oklch',
            detail: 'Perceptually uniform color from lightness, chroma, hue (new in Desmos v1.12)',
            snippet: 'oklch(${1:l}, ${2:c}, ${3:h})',
            category: 'color',
        },

        // Combinatorics
        {
            name: 'nCr',
            detail: 'Combinations',
            snippet: 'nCr(${1:n}, ${2:r})',
            category: 'combinatorics',
        },
        {
            name: 'nPr',
            detail: 'Permutations',
            snippet: 'nPr(${1:n}, ${2:r})',
            category: 'combinatorics',
        },
        {
            name: 'factorial',
            detail: 'Factorial',
            snippet: 'factorial(${1:n})',
            category: 'combinatorics',
        },

        // Audio — plays rather than draws, and is gated by the `tone` config
        // property and by the calculator being unmuted
        {
            name: 'tone',
            detail: 'Play a tone at a frequency in hertz, at a volume of 0-1',
            snippet: 'tone(${1:frequency}, ${2:volume})',
            category: 'audio',
        },
    ] satisfies FunctionDefinition[],

    operators: [
        { name: 'width', detail: 'Viewport width, in graph units', category: 'viewport' },
        { name: 'height', detail: 'Viewport height, in graph units', category: 'viewport' },
        {
            name: 'for',
            detail: 'List comprehension: [i ^ 2 for i = [1...10]]',
            category: 'list',
        },
        {
            name: 'with',
            detail: 'Local definition: f(x) = x n with n = length(a)',
            category: 'scope',
        },
        {
            name: 'index',
            detail: "The element's 1-based position, inside a list filter or a clickable action",
            category: 'list',
        },
        {
            // How it is spelt in latex is the compiler's business; here it is a
            // name the checker should know, so `n -> n + dt` is not an
            // undefined variable offered as a slider.
            name: 'dt',
            detail: 'Milliseconds since the last tick, inside a ticker handler',
            category: 'ticker',
        },
    ] satisfies OperatorDefinition[],

    constants: [
        // Greek letters
        { name: 'pi', detail: 'π ≈ 3.14159', category: 'greek' },
        { name: 'tau', detail: 'τ = 2π ≈ 6.28318', category: 'greek' },
        { name: 'theta', detail: 'Greek letter θ', category: 'greek' },
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
        { name: 'e', detail: "Euler's number ≈ 2.71828", category: 'mathematical', latex: null },
        { name: 'infinity', detail: '∞', category: 'mathematical', latex: '\\infty' },

        // Boolean
        { name: 'true', detail: 'Boolean true', category: 'boolean', latex: null },
        { name: 'false', detail: 'Boolean false', category: 'boolean', latex: null },
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
            snippet: 'use: ${1:style}',
            valueType: 'style',
            appliesTo: ['expression', 'column', 'table', 'style'],
            repeatable: true,
        },
        {
            name: 'color',
            detail: 'Colour: #hex, a palette name (RED, BLUE, GREEN, PURPLE, ORANGE, BLACK), or any expression such as rgb(255, 0, 0) [default: cycles]',
            snippet: 'color: ${1|RED,BLUE,GREEN,PURPLE,ORANGE,BLACK|}',
            valueType: 'color',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'suppressTextOutline',
            detail: 'Drop the outline drawn behind a label [default: false]',
            snippet: 'suppressTextOutline',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'lineStyle',
            detail: 'Line style [default: SOLID]',
            snippet: 'lineStyle: ${1|SOLID,DASHED,DOTTED|}',
            valueType: 'enum',
            values: ['SOLID', 'DASHED', 'DOTTED'],
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'lineWidth',
            detail: 'Line width in pixels [default: 2.5]',
            snippet: 'lineWidth: ${1:2.5}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'lineOpacity',
            detail: 'Line opacity 0-1 [default: 0.9]',
            snippet: 'lineOpacity: ${1:0.9}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'pointStyle',
            detail: 'Point style [default: POINT]',
            snippet: 'pointStyle: ${1|POINT,OPEN,CROSS,SQUARE,PLUS,TRIANGLE,DIAMOND,STAR|}',
            valueType: 'enum',
            values: ['POINT', 'OPEN', 'CROSS', 'SQUARE', 'PLUS', 'TRIANGLE', 'DIAMOND', 'STAR'],
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'pointSize',
            detail: 'Point diameter in pixels [default: 9]',
            snippet: 'pointSize: ${1:9}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'movablePointSize',
            detail: 'Point diameter in pixels while the point is draggable [default: matches pointSize]',
            snippet: 'movablePointSize: ${1:9}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'pointOpacity',
            detail: 'Point opacity 0-1 [default: 0.9]',
            snippet: 'pointOpacity: ${1:0.9}',
            valueType: 'expression',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'fillOpacity',
            detail: 'Fill opacity 0-1 [default: 0.4]',
            snippet: 'fillOpacity: ${1:0.4}',
            valueType: 'expression',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'hidden',
            detail: 'Hide graph [default: false]',
            snippet: 'hidden',
            valueType: 'boolean',
            appliesTo: ['expression', 'column', 'table', 'folder', 'image', 'import', 'style'],
        },
        {
            name: 'secret',
            detail: 'Hide from the expression list, for authors [default: false]',
            snippet: 'secret',
            valueType: 'boolean',
            appliesTo: ['expression', 'folder', 'image', 'import', 'note', 'style'],
        },
        {
            name: 'points',
            detail: 'Show points [default: true]',
            snippet: 'points: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'lines',
            detail: 'Show lines [default: true]',
            snippet: 'lines: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['expression', 'column', 'table', 'style'],
        },
        {
            name: 'fill',
            detail: 'Fill region [default: false]',
            snippet: 'fill',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'label',
            detail: 'Point label text [default: empty]',
            snippet: 'label: "${1:}"',
            valueType: 'string',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'showLabel',
            detail: 'Show label [default: false]',
            snippet: 'showLabel',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'labelSize',
            detail: 'Label size multiplier [default: 1]',
            snippet: 'labelSize: ${1:1}',
            valueType: 'expression',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'labelOrientation',
            detail: 'Label position [default: default]',
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
            name: 'pointOutline',
            detail: 'Ring each point in the background colour [default: false]',
            snippet: 'pointOutline',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'dragMode',
            detail: 'Drag mode [default: AUTO]',
            snippet: 'dragMode: ${1|AUTO,X,Y,XY,NONE|}',
            valueType: 'enum',
            values: ['AUTO', 'X', 'Y', 'XY', 'NONE'],
            appliesTo: ['expression', 'column', 'table', 'image', 'style'],
        },
        {
            name: 'playing',
            detail: 'Animate slider [default: false]',
            snippet: 'playing',
            valueType: 'boolean',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'onClick',
            detail: 'Action run when the object is clicked, e.g. `onClick: a -> a + 1` or a run `a -> 1, b -> 2`',
            snippet: 'onClick: ${1:a} -> ${2:value}',
            valueType: 'action',
            appliesTo: ['expression', 'image', 'style'],
        },
        {
            name: 'clickable',
            detail: 'Enable/disable the onClick action [default: true when onClick is set]',
            snippet: 'clickable: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['expression', 'image', 'style'],
        },
        {
            name: 'description',
            detail: 'Screen-reader description, shown for clickable objects',
            snippet: 'description: "${1:}"',
            valueType: 'string',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'slider',
            detail: "Slider range for a defined value, e.g. `slider: -5..5 step 0.5`. Both ends are limits unless `soft`, `soft min` or `soft max` says otherwise, and either end may be left out to keep Desmos' own",
            snippet: 'slider: ${1:0}..${2:10}',
            valueType: 'range',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'loopMode',
            detail: 'What an animating slider does at the end of its range [default: LOOP_FORWARD_REVERSE]',
            snippet:
                'loopMode: ${1|LOOP_FORWARD_REVERSE,LOOP_FORWARD,PLAY_ONCE,PLAY_INDEFINITELY|}',
            valueType: 'enum',
            values: ['LOOP_FORWARD_REVERSE', 'LOOP_FORWARD', 'PLAY_ONCE', 'PLAY_INDEFINITELY'],
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'playDirection',
            detail: 'Which way an animating slider runs: 1 forwards, -1 backwards [default: 1]',
            snippet: 'playDirection: ${1|1,-1|}',
            valueType: 'number',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'animationPeriod',
            detail: 'How long one sweep of an animating slider takes, in milliseconds [default: 8000]',
            snippet: 'animationPeriod: ${1:8000}',
            valueType: 'number',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'domain',
            detail: 'The range a parametric or polar curve is drawn over, e.g. `domain: 0..2pi`',
            snippet: 'domain: ${1:0}..${2:2pi}',
            valueType: 'range',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'parametricDomain',
            detail: 'The older copy of `domain` Desmos writes beside it, for a graph whose two disagree',
            snippet: 'parametricDomain: ${1:0}..${2:2pi}',
            valueType: 'range',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'polarDomain',
            detail: 'The range a polar curve is drawn over in polar mode, e.g. `polarDomain: 0..2pi`',
            snippet: 'polarDomain: ${1:0}..${2:2pi}',
            valueType: 'range',
            appliesTo: ['expression', 'style'],
        },
        {
            name: 'name',
            detail: 'The caption an image carries in the expression list',
            snippet: 'name: "${1:}"',
            valueType: 'string',
            appliesTo: ['image'],
        },
        {
            name: 'center',
            detail: 'The point an image is centred on, e.g. `center: (0, 0)`',
            snippet: 'center: (${1:0}, ${2:0})',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'width',
            detail: 'How wide an image is drawn, in graph units',
            snippet: 'width: ${1:10}',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'height',
            detail: 'How tall an image is drawn, in graph units',
            snippet: 'height: ${1:10}',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'angle',
            detail: 'How far an image is rotated, anticlockwise, in radians',
            snippet: 'angle: ${1:0}',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'opacity',
            detail: 'Image opacity 0-1 [default: 1]',
            snippet: 'opacity: ${1:1}',
            valueType: 'expression',
            appliesTo: ['image'],
        },
        {
            name: 'foreground',
            detail: 'Draw an image over the graph rather than under it [default: false]',
            snippet: 'foreground',
            valueType: 'boolean',
            appliesTo: ['image'],
        },
        {
            name: 'collapsed',
            detail: 'Start a folder collapsed [default: false; an import starts collapsed]',
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
            snippet: 'minStep: ${1:50}',
            valueType: 'expression',
            appliesTo: ['ticker'],
        },
        {
            name: 'playing',
            detail: 'Start the ticker running when the graph opens [default: false]',
            snippet: 'playing',
            valueType: 'boolean',
            appliesTo: ['ticker'],
        },
        {
            name: 'open',
            detail: 'Show the ticker expanded in the expression list [default: false]',
            snippet: 'open',
            valueType: 'boolean',
            appliesTo: ['ticker'],
        },
    ] satisfies PropertyDefinition[],

    /** Entries of the `config` block, which become the calculator's settings. */
    configProperties: [
        {
            name: 'degreeMode',
            detail: 'Use degrees instead of radians [default: false]',
            snippet: 'degreeMode: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showGrid',
            detail: 'Show coordinate grid [default: true]',
            snippet: 'showGrid: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showXAxis',
            detail: 'Show x-axis [default: true]',
            snippet: 'showXAxis: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showYAxis',
            detail: 'Show y-axis [default: true]',
            snippet: 'showYAxis: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'xAxisNumbers',
            detail: 'Show numbers on x-axis [default: true]',
            snippet: 'xAxisNumbers: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'yAxisNumbers',
            detail: 'Show numbers on y-axis [default: true]',
            snippet: 'yAxisNumbers: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'polarMode',
            detail: 'Use polar coordinates [default: false]',
            snippet: 'polarMode: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'lockViewport',
            detail: 'Lock viewport from panning/zooming [default: false]',
            snippet: 'lockViewport: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'xmin',
            detail: 'Left edge of the viewport [default: -10]',
            snippet: 'xmin: ${1:-10}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'xmax',
            detail: 'Right edge of the viewport [default: 10]',
            snippet: 'xmax: ${1:10}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'ymin',
            detail: 'Bottom edge of the viewport [default: fits the aspect ratio]',
            snippet: 'ymin: ${1:-10}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'ymax',
            detail: 'Top edge of the viewport [default: fits the aspect ratio]',
            snippet: 'ymax: ${1:10}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'squareAxes',
            detail: 'Keep one x unit the same length as one y unit [default: true]',
            valueType: 'boolean',
            appliesTo: ['config'],
            snippet: 'squareAxes: ${1|true,false|}',
        },
        {
            name: 'userLockedViewport',
            detail: "Lock the viewport the way the graph's own settings menu does, so nobody can pan or zoom [default: false]",
            valueType: 'boolean',
            appliesTo: ['config'],
            snippet: 'userLockedViewport: ${1|true,false|}',
        },
        {
            name: 'expressionsCollapsed',
            detail: 'Collapse expressions list [default: true]',
            snippet: 'expressionsCollapsed: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'capExpressionSize',
            detail: 'Limit expression complexity [default: true]',
            snippet: 'capExpressionSize: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'pointsOfInterest',
            detail: 'Show points of interest [default: true]',
            snippet: 'pointsOfInterest: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'trace',
            detail: 'Enable trace mode [default: false]',
            snippet: 'trace: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'border',
            detail: 'Show calculator border [default: false]',
            snippet: 'border: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'keypad',
            detail: 'Show on-screen keypad [default: true]',
            snippet: 'keypad: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'graphpaper',
            detail: 'Show graph paper background [default: true]',
            snippet: 'graphpaper: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'calculus',
            detail: 'Allow derivatives and integrals [default: true] (Desmos v1.12)',
            snippet: 'calculus: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'clearIntoDegreeMode',
            detail: 'Clearing the graph keeps degree mode [default: matches degreeMode] (Desmos v1.12)',
            snippet: 'clearIntoDegreeMode: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'invertedColors',
            detail: 'Invert every displayed color [default: false]',
            snippet: 'invertedColors: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'invertedColorsControl',
            detail: 'Show the "Reverse Contrast" checkbox [default: true] (Desmos v1.12)',
            snippet: 'invertedColorsControl: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'backgroundColor',
            detail: 'Calculator background colour, #hex or a palette name [beta, Desmos v1.12]',
            snippet: 'backgroundColor: ${1:#fff}',
            valueType: 'color',
            appliesTo: ['config'],
        },
        {
            name: 'textColor',
            detail: 'Calculator text colour, #hex or a palette name [beta, Desmos v1.12]',
            snippet: 'textColor: ${1:#000}',
            valueType: 'color',
            appliesTo: ['config'],
        },
        {
            name: 'accentColor',
            detail: 'Accent colour for buttons and focus outlines, #hex or a palette name [beta, Desmos v1.12]',
            snippet: 'accentColor: ${1:#2f72dc}',
            valueType: 'color',
            appliesTo: ['config'],
        },
        {
            name: 'showReducedMotionCover',
            detail: 'Pause animations for prefers-reduced-motion [default: false]',
            snippet: 'showReducedMotionCover: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'projectorMode',
            detail: 'Larger fonts and thicker lines [default: false]',
            snippet: 'projectorMode: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'zoomFit',
            detail: 'Allow expressions to specify a viewport [default: true]',
            snippet: 'zoomFit: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'xAxisLabel',
            detail: 'Label for the x-axis [default: empty]',
            snippet: 'xAxisLabel: "${1:}"',
            valueType: 'string',
            appliesTo: ['config'],
        },
        {
            name: 'yAxisLabel',
            detail: 'Label for the y-axis [default: empty]',
            snippet: 'yAxisLabel: "${1:}"',
            valueType: 'string',
            appliesTo: ['config'],
        },
        {
            name: 'xAxisScale',
            detail: 'x-axis scale [default: linear]',
            snippet: 'xAxisScale: ${1|linear,logarithmic|}',
            valueType: 'enum',
            values: ['linear', 'logarithmic'],
            appliesTo: ['config'],
        },
        {
            name: 'yAxisScale',
            detail: 'y-axis scale [default: linear]',
            snippet: 'yAxisScale: ${1|linear,logarithmic|}',
            valueType: 'enum',
            values: ['linear', 'logarithmic'],
            appliesTo: ['config'],
        },
        {
            name: 'randomSeed',
            detail: 'Seed for random() [default: generated]',
            snippet: 'randomSeed: "${1:}"',
            valueType: 'string',
            appliesTo: ['config'],
        },
        {
            name: 'includeFunctionParametersInRandomSeed',
            detail: "Vary random() by a function's arguments [default: true]",
            snippet: 'includeFunctionParametersInRandomSeed: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'fontSize',
            detail: 'Base font size [default: 16]',
            snippet: 'fontSize: ${1:16}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'language',
            detail: 'UI language [default: en]',
            snippet: 'language: "${1:en}"',
            valueType: 'string',
            appliesTo: ['config'],
        },

        // Behaviour toggles
        {
            name: 'expressions',
            detail: 'Show the expressions list [default: true]',
            snippet: 'expressions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'expressionsTopbar',
            detail: 'Show the toolbar above the expressions list [default: true]',
            snippet: 'expressionsTopbar: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'zoomButtons',
            detail: 'Show the zoom buttons [default: false]',
            snippet: 'zoomButtons: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'keypadActivated',
            detail: 'Open the keypad on load [default: false]',
            snippet: 'keypadActivated: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showResetButtonOnGraphpaper',
            detail: 'Show a reset button on the graph paper [default: false]',
            snippet: 'showResetButtonOnGraphpaper: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'settingsMenu',
            detail: 'Show the graph settings menu [default: false]',
            snippet: 'settingsMenu: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'authorFeatures',
            detail: 'Enable author features such as secret folders [default: false]',
            snippet: 'authorFeatures: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'administerSecretFolders',
            detail: 'Reveal the contents of secret folders [default: false]',
            snippet: 'administerSecretFolders: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'images',
            detail: 'Allow images [default: true]',
            snippet: 'images: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'folders',
            detail: 'Allow folders [default: true]',
            snippet: 'folders: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'notes',
            detail: 'Allow notes [default: true]',
            snippet: 'notes: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'sliders',
            detail: 'Allow sliders [default: true]',
            snippet: 'sliders: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'substitutions',
            detail: 'Allow "with" substitutions [default: true]',
            snippet: 'substitutions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'qwertyKeyboard',
            detail: 'Show the QWERTY keyboard on the keypad [default: true]',
            snippet: 'qwertyKeyboard: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'distributions',
            detail: 'Allow statistical distributions [default: true]',
            snippet: 'distributions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'restrictedFunctions',
            detail: 'Limit the available functions to a basic set [default: false]',
            snippet: 'restrictedFunctions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'forceEnableGeometryFunctions',
            detail: 'Enable geometry functions [default: false]',
            snippet: 'forceEnableGeometryFunctions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'pasteGraphLink',
            detail: 'Allow pasting a graph link to import it [default: false]',
            snippet: 'pasteGraphLink: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'pasteTableData',
            detail: 'Allow pasting tabular data into a table [default: true]',
            snippet: 'pasteTableData: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'autosize',
            detail: 'Resize the calculator with its container [default: true]',
            snippet: 'autosize: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'plotInequalities',
            detail: 'Shade inequalities [default: true]',
            snippet: 'plotInequalities: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'plotImplicits',
            detail: 'Plot implicit equations and inequalities [default: true]',
            snippet: 'plotImplicits: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'plotSingleVariableImplicitEquations',
            detail: 'Plot single-variable implicit equations [default: true]',
            snippet: 'plotSingleVariableImplicitEquations: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'brailleControls',
            detail: 'Show braille controls [default: true]',
            snippet: 'brailleControls: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'audio',
            detail: 'Enable audio trace [default: true]',
            snippet: 'audio: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'tone',
            detail: 'Allow the tone() function [default: true]',
            snippet: 'tone: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'muted',
            detail: 'Mute audio output [default: false]',
            snippet: 'muted: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'forceLogModeRegressions',
            detail: 'Force regressions into log mode [default: false]',
            snippet: 'forceLogModeRegressions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'defaultLogModeRegressions',
            detail: 'Default new regressions to log mode [default: false]',
            snippet: 'defaultLogModeRegressions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'customRegressions',
            detail: 'Allow custom regressions [default: true]',
            snippet: 'customRegressions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'regressionTemplates',
            detail: 'Offer regression templates [default: true]',
            snippet: 'regressionTemplates: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'logScales',
            detail: 'Allow logarithmic axis scales [default: true]',
            snippet: 'logScales: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'intervalComprehensions',
            detail: 'Allow interval comprehensions [default: true]',
            snippet: 'intervalComprehensions: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'allowComplex',
            detail: 'Allow complex numbers [default: false]',
            snippet: 'allowComplex: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'recursion',
            detail: 'Allow recursive definitions [default: false]',
            snippet: 'recursion: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'showEvaluationCopyButtons',
            detail: 'Show copy buttons beside evaluations [default: false]',
            snippet: 'showEvaluationCopyButtons: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'decimalToFraction',
            detail: 'Offer decimal/fraction toggling [default: true]',
            snippet: 'decimalToFraction: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'sixKeyInput',
            detail: 'Enable six-key braille input [default: false]',
            snippet: 'sixKeyInput: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },
        {
            name: 'polarNumbers',
            detail: 'Show numbers on the polar grid [default: true]',
            snippet: 'polarNumbers: ${1|true,false|}',
            valueType: 'boolean',
            appliesTo: ['config'],
        },

        // Axis scaling
        {
            name: 'xAxisStep',
            detail: 'Spacing between x-axis labels, 0 for automatic [default: 0]',
            snippet: 'xAxisStep: ${1:0}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'yAxisStep',
            detail: 'Spacing between y-axis labels, 0 for automatic [default: 0]',
            snippet: 'yAxisStep: ${1:0}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'xAxisMinorSubdivisions',
            detail: 'Minor grid lines per x-axis step, 0 for automatic [default: 0]',
            snippet: 'xAxisMinorSubdivisions: ${1:0}',
            valueType: 'number',
            appliesTo: ['config'],
        },
        {
            name: 'yAxisMinorSubdivisions',
            detail: 'Minor grid lines per y-axis step, 0 for automatic [default: 0]',
            snippet: 'yAxisMinorSubdivisions: ${1:0}',
            valueType: 'number',
            appliesTo: ['config'],
        },

        // Enumerated settings
        {
            name: 'xAxisArrowMode',
            detail: 'Arrowheads on the x-axis [default: NONE]',
            snippet: 'xAxisArrowMode: ${1|NONE,POSITIVE,BOTH|}',
            valueType: 'enum',
            values: ['NONE', 'POSITIVE', 'BOTH'],
            appliesTo: ['config'],
        },
        {
            name: 'yAxisArrowMode',
            detail: 'Arrowheads on the y-axis [default: NONE]',
            snippet: 'yAxisArrowMode: ${1|NONE,POSITIVE,BOTH|}',
            valueType: 'enum',
            values: ['NONE', 'POSITIVE', 'BOTH'],
            appliesTo: ['config'],
        },
        {
            name: 'actions',
            detail: 'Allow action expressions [default: auto]',
            snippet: 'actions: ${1|true,false,auto|}',
            valueType: 'enum',
            values: ['true', 'false', 'auto'],
            appliesTo: ['config'],
        },
        {
            name: 'reportPosition',
            detail: 'Position readout for screen readers [default: default]',
            snippet: 'reportPosition: ${1|default,coordinates,percents|}',
            valueType: 'enum',
            values: ['default', 'coordinates', 'percents'],
            appliesTo: ['config'],
        },
        {
            name: 'brailleMode',
            detail: 'Braille code [default: none]',
            snippet: 'brailleMode: ${1|none,nemeth,ueb|}',
            valueType: 'enum',
            values: ['none', 'nemeth', 'ueb'],
            appliesTo: ['config'],
        },
        {
            name: 'graphDescription',
            detail: 'Screen-reader description of the whole graph [default: empty]',
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
 * The {@link AXIS_STATE_PROPERTY_NAMES} defaults, for a script that says
 * nothing. Separate from {@link AXIS_DEFAULT_CONFIG} because these go somewhere
 * else entirely — that one is calculator options, this one is graph state.
 *
 * Desmos reads a state with no `includeFunctionParametersInRandomSeed` as the
 * legacy randomization behaviour, under which `random()` and `shuffle` inside a
 * function return the same draw for every argument. A graph made at desmos.com
 * today is migrated off that, so a script written today starts off it too — and
 * a legacy graph being decompiled has to say `false` to keep what it had.
 */
export const AXIS_DEFAULT_STATE: Readonly<Record<string, boolean>> = {
    includeFunctionParametersInRandomSeed: true,
};

/**
 * The calculator options Axis applies when a script does not say otherwise.
 *
 * Desmos's own defaults are those of the full editor at desmos.com - the
 * expression list open beside the graph, the settings menu, the zoom buttons
 * and a border around the lot. A compiled Axis script is a *finished* graph
 * rather than something to be edited in place, so it wants the picture: the
 * chrome is off and the expression list starts collapsed, there to be opened
 * by anyone who wants to read the maths but not in the way of the graph.
 * Anything a script writes in its own `config { … }` still wins, so
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
