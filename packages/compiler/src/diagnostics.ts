// ═════════════════════════════════════════════════════════════════════════════
// The diagnostics the checker, the compiler and the decompiler report
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler's half of the catalogue whose other half is syntax's
// `SYNTAX_DIAGNOSTICS`: every code declared once, with the spec's summary of
// it (§8, §11) and something that raises it, and every place that reports one
// typed to take nothing else. The docs site's page of diagnostics is generated
// from the two.

import type { Diagnostic, DiagnosticInfo, SyntaxDiagnosticCode } from '@axis-dsl/syntax';

/**
 * What the checker and the compiler report about a file. An example is read
 * as though it sat in `examples/graph.axis`, so it can name an image
 * or an import that is not there - or itself.
 */
export const COMPILER_DIAGNOSTICS = {
    // Names and expressions
    'unknown-function': {
        summary: 'a call on a name that is not a function (§5.3)',
        example: 'y = sine(x)',
    },
    'assign-to-builtin': {
        summary:
            "defining or binding a function's name, an operator, `pi`, `tau`, `e`, `infinity`, `true`/`false`",
        example: 'pi = 3',
    },
    'theta-equation': {
        summary: '`theta = …`, which Desmos will not graph - write `r = …` (§5.5)',
        example: 'theta = 1',
    },
    'requires-complex-mode': {
        summary: '`real`, `imag`, `conj` or `arg` in a graph without `allowComplex: true` (§5.3)',
        example: 'a = real(3)',
    },
    'requires-calculator': {
        summary: 'a function or a `$` token the calculator the graph is for does not have',
        example: 'A = (0, 0)\nB = (4, 1)\ns = segment(A, B)',
    },
    'statement-only': {
        summary: 'a chart or a regression `~` anywhere but as a statement of its own',
        example: 'L = [1, 2, 3]\nH = histogram(L)',
    },
    'multiple-subscripts': {
        summary: 'a name in an expression with more than one `_` part (`x_1_2`)',
        example: 'a = x_1_2',
    },
    'boolean-in-expression': {
        summary: '`true` or `false` in an expression - Desmos has no booleans',
        example: 'a = true + 1',
    },
    'dt-outside-ticker': {
        summary: "`dt` anywhere but the ticker's handler (or a macro's body)",
        example: 'a = dt',
    },
    'rebound-variable': {
        summary: 'a `sum`, `prod` or `int` variable already bound where it stands',
        example: 'f(k) = sum(k = 1..3, k)',
    },
    'unexpected-string': {
        summary: 'a string where a value belongs',
        example: 'a = "one" + 1',
    },

    // Properties
    'unknown-property': {
        summary: 'a property no placement has',
        example: 'y = x @ colour: RED',
    },
    'misplaced-property': {
        summary: 'a property this placement does not take, directly or through a style',
        example: 'folder "Waves" { @ color: RED\n    y = sin(x)\n}',
    },
    'duplicate-property': {
        summary: 'a property given twice in one clause',
        example: 'y = x @ color: RED, color: BLUE',
    },
    'invalid-value': {
        summary: 'a value of the wrong type for its property (§4.2)',
        example: 'y = x @ lines: 3',
    },
    'invalid-enum': {
        summary: 'an enum value the property does not list',
        example: 'y = x @ lineStyle: WAVY',
    },
    'invalid-color': {
        summary: 'a colour that is not one (§4.3)',
        example: 'y = x @ color: red',
    },
    'unexpected-range': {
        summary: 'a range for a property that takes none',
        example: 'y = x @ lineWidth: 1..3',
    },

    // Statements
    'invalid-column': {
        summary: 'a table column that is an equation (`x = 5`)',
        example: 'table { x = 5 }',
    },
    'misplaced-config': {
        summary: '`config` inside a folder',
        example: 'folder "Settings" {\n    config { showGrid: false }\n}',
    },
    'misplaced-ticker': {
        summary: '`ticker` inside a folder',
        example: 'n = 0\nfolder "Clock" {\n    ticker n -> n + 1\n}',
    },
    'misplaced-style': {
        summary: '`style` inside a folder',
        example: 'folder "Styles" {\n    style thick { lineWidth: 5 }\n}',
    },
    'misplaced-macro': {
        summary: '`macro` inside a folder',
        example: 'folder "Macros" {\n    macro double(a) = 2a\n}',
    },
    'nested-folder': {
        summary: 'a folder inside a folder',
        example: 'folder "Outer" {\n    folder "Inner" { y = x }\n}',
    },
    'duplicate-config': {
        summary: 'a second `config` in one file',
        example: 'config { showGrid: false }\nconfig { showGrid: true }',
    },
    'duplicate-ticker': {
        summary: 'a second `ticker` in one file',
        example: 'n = 0\nticker n -> n + 1\nticker n -> n - 1',
    },

    // Macros and styles
    'duplicate-macro': {
        summary: 'a second macro of one name anywhere in the compilation',
        example: 'macro double(a) = 2a\nmacro double(a) = a + a',
    },
    'macro-collision': {
        summary: 'a macro named after a builtin, a function or a variable',
        example: 'macro sin(a) = a',
    },
    'macro-arity': {
        summary: 'a macro used with the wrong number of arguments, or with or without `()` wrongly',
        example: 'macro double(a) = 2a\ny = double(x, 1)',
    },
    'macro-recursion': {
        summary: 'a macro that expands into itself',
        example: 'macro loop(a) = loop(a) + 1\ny = loop(x)',
    },
    'duplicate-style': {
        summary: 'a second style of one name anywhere in the compilation',
        example: 'style thick { lineWidth: 5 }\nstyle thick { lineWidth: 8 }',
    },
    'unknown-style': {
        summary: '`use:` naming no style',
        example: 'y = x @ use: bold',
    },
    'style-cycle': {
        summary: 'a style that uses itself, reported at the `use:` that closes the loop',
        example: 'style a { use: b }\nstyle b { use: a }',
    },

    // Files
    'unresolved-import': {
        summary: 'an import that cannot be read',
        example: 'import "./lib/missing"',
    },
    'import-cycle': {
        summary: 'an import that closes a cycle',
        example: '// graph.axis\nimport "./graph"',
    },
    'unresolved-image': {
        summary: 'an image file that cannot be read',
        example: 'image "./images/missing.png"',
    },
    'invalid-image': {
        summary: 'an image path that is not a picture by its extension',
        example: 'image "./notes.txt"',
    },
} as const satisfies Record<string, DiagnosticInfo>;

export type CompilerDiagnosticCode = keyof typeof COMPILER_DIAGNOSTICS;

/**
 * What the decompiler reports about a graph it cannot write all of. Each is a
 * warning, and the statement is written with a comment in its place. There is
 * no file to raise one - the input is a graph - so these carry a summary
 * alone.
 */
export const DECOMPILER_DIAGNOSTICS = {
    'unsupported-latex': { summary: 'latex the expression tree has no node for' },
    'unsupported-item': {
        summary: 'a list item Axis has no statement for, or an image with no URL',
    },
    'unsupported-value': {
        summary: 'a colour or enum value Axis cannot write, or a blank cell',
    },
} as const satisfies Record<string, Pick<DiagnosticInfo, 'summary'>>;

export type DecompilerDiagnosticCode = keyof typeof DECOMPILER_DIAGNOSTICS;

/** Every code a compilation can report: the parser's and its own. */
export type AxisDiagnosticCode = SyntaxDiagnosticCode | CompilerDiagnosticCode;

/** A diagnostic whose code is one the catalogues declare. */
export type AxisDiagnostic = Diagnostic<AxisDiagnosticCode>;
