// ═════════════════════════════════════════════════════════════════════════════
// The checker - what the parser cannot know about a file
// ═════════════════════════════════════════════════════════════════════════════
//
// The parser reads any file that is well formed and has no opinion about
// what it says. This is where it gets one: whether `notAFunction(x)` names a
// function, whether `collapsed` belongs on a point, whether `color: red` is a
// colour, whether a `ticker` is inside a folder. Spec §8 lists the rules and
// §4.6 the placements; the manifest in `@axis-dsl/syntax` is the authority on
// every property, so nothing here lists one by hand.
//
// Every one of these is a mistake Desmos would *not* report. It accepts
// `n_{otAFunction}\left(x\right)` as a product of variables and never
// evaluates it, ignores a property it does not know, and draws nothing for
// `\pi=3` - the harness found each of those, and the checker exists so that an
// author hears about them from the compiler instead of from a graph that is
// quietly wrong.
//
// The checker reads the tree as it was written, before any macro is expanded,
// so a diagnostic always points at text the author can see. A macro's body is
// checked once, where it is defined, and each use of it only for its arity.
//
// Undefined *variables* are not errors: Desmos offers one as a slider, which is
// a feature. Undefined *functions* are, because a call that is not a call is
// never what somebody meant.

import {
    AXIS_COMPLEX_FUNCTION_NAMES,
    AXIS_MANIFEST,
    AXIS_CONSTANT_NAME_SET,
    AXIS_FUNCTION_NAME_SET,
    AXIS_OPERATOR_NAME_SET,
    AXIS_PALETTE_HEX,
    type Call,
    type Diagnostic,
    enumValue,
    type Expression,
    findProperty,
    type Identifier,
    type Metadata,
    placementsOf,
    type Prime,
    type Property,
    type PropertyValue,
    type PropertyDefinition,
    type PropertyPlacement,
    type Span,
    type Statement,
} from '@axis-dsl/syntax';
import type { CompilerDiagnosticCode } from './diagnostics';
import { located, type Program, type SourceFile } from './program';
import { styleProperties } from './styles';
import { definitionOf, RESERVED_NAMES, type Symbols } from './symbols';
import { childrenOf } from './walk';

export interface CheckResult {
    diagnostics: Diagnostic[];
    /**
     * The `Call` nodes that are really products - `a(b + 1)` is a·(b + 1) -
     * for a tool that wants to say so. Both lower to the same latex, so the
     * compiler itself never asks.
     */
    products: WeakSet<Call>;
}

/** How a placement is named in a message: "`collapsed` does not go on a point". */
const PLACEMENT_NOUNS: Readonly<Record<PropertyPlacement, string>> = {
    expression: 'an expression',
    folder: 'a folder',
    table: 'a table',
    column: 'a table column',
    image: 'an image',
    ticker: 'the ticker',
    import: 'an import',
    note: 'a note',
    config: 'config',
    style: 'a style',
};

/** What an expression is being checked inside of. */
interface Scope {
    file: SourceFile;
    /** Names bound here: function parameters, `with`/`for` bindings, macro parameters. */
    bound: ReadonlySet<string>;
    /** Inside the ticker's handler, where `dt` exists. */
    ticker: boolean;
    /** Inside a macro's body, which is checked for what it could be used as. */
    macro: boolean;
}

/** The calculators each function the graphing calculator lacks exists on. */
const FUNCTION_CALCULATORS: ReadonlyMap<string, readonly string[]> = new Map(
    AXIS_MANIFEST.functions.flatMap(fn =>
        fn.calculators ? [[fn.name, fn.calculators] as const] : [],
    ),
);

/** How a `calculator:` value is named in a message. */
const CALCULATOR_NAMES: Readonly<Record<string, string>> = {
    GRAPHING: 'graphing',
    GEOMETRY: 'geometry',
    GRAPHING_3D: '3D',
};

/** The functions that draw a chart, and so stand as a statement alone. */
const CHARTS: ReadonlySet<string> = new Set(
    AXIS_MANIFEST.functions.filter(fn => fn.category === 'chart').map(fn => fn.name),
);

/** `histogram(L)`, `stats(L)`: a chart, drawn by a statement of its own. */
function isChart(node: Expression): node is Call {
    return node.kind === 'Call' && CHARTS.has(node.callee.name);
}

/** `ys ~ m xs + b`: a regression, one `~` and two sides. */
function isRegression(node: Expression): boolean {
    return node.kind === 'Comparison' && node.operators.length === 1 && node.operators[0] === '~';
}

/** The members that read a point's coordinates rather than call a function. */
const COORDINATES: ReadonlySet<string> = new Set(['x', 'y', 'z']);

/** Check every file of `program` against the names it defines. */
export function checkProgram(program: Program, symbols: Symbols): CheckResult {
    const diagnostics: Diagnostic[] = [];
    const products = new WeakSet<Call>();

    let file: SourceFile = program.entry;
    const report = (code: CompilerDiagnosticCode, message: string, span: Span): void => {
        diagnostics.push(located({ code, severity: 'error', message, span }, file));
    };

    const complexMode = allowsComplex(program);
    // The charts and regressions that stand as a statement of their own,
    // which is the only place Desmos draws one.
    const standing = new WeakSet<Expression>();
    const stand = (expression: Expression): void => {
        if (isChart(expression) || isRegression(expression)) standing.add(expression);
    };
    const calculator = calculatorOf(program);

    // ─────────────────────────────────────────────────────────────────────────
    // Statements
    // ─────────────────────────────────────────────────────────────────────────

    const checkFile = (current: SourceFile): void => {
        file = current;
        const counts = { config: 0, ticker: 0 };
        checkStatements(current.tree.file.statements, false, counts);
    };

    const checkStatements = (
        statements: readonly Statement[],
        inFolder: boolean,
        counts: { config: number; ticker: number },
    ): void => {
        const scope: Scope = { file, bound: new Set(), ticker: false, macro: false };

        for (const statement of statements) {
            switch (statement.kind) {
                case 'ConfigStatement':
                    if (inFolder) {
                        report(
                            'misplaced-config',
                            '`config` belongs at the top level of a file, not inside a folder.',
                            keyword(statement.span, 'config'),
                        );
                    } else if (counts.config++ > 0) {
                        report(
                            'duplicate-config',
                            'A file has one `config` block; merge this one into the first.',
                            keyword(statement.span, 'config'),
                        );
                    }
                    checkProperties(statement.entries, 'config', scope);
                    break;

                case 'FolderStatement':
                    if (inFolder) {
                        report(
                            'nested-folder',
                            'Folders do not nest - Desmos has one level of them.',
                            keyword(statement.span, 'folder'),
                        );
                    }
                    checkMetadata(statement.metadata, 'folder', scope);
                    checkStatements(statement.body, true, counts);
                    break;

                case 'TableStatement':
                    checkMetadata(statement.metadata, 'table', scope);
                    for (const column of statement.columns) {
                        if (column.values === null && isEquation(column.header)) {
                            report(
                                'invalid-column',
                                'A table column is `name = [values]` or an expression to compute; an equation is neither.',
                                column.header.span,
                            );
                        } else {
                            checkExpression(column.header, scope);
                        }
                        for (const value of column.values ?? []) {
                            checkExpression(value, scope);
                        }
                        checkMetadata(column.metadata, 'column', scope);
                    }
                    break;

                case 'StyleStatement':
                    if (inFolder) {
                        report(
                            'misplaced-style',
                            'A `style` belongs at the top level of a file, not inside a folder.',
                            keyword(statement.span, 'style'),
                        );
                    }
                    checkProperties(statement.entries, 'style', scope);
                    break;

                case 'MacroStatement':
                    if (inFolder) {
                        report(
                            'misplaced-macro',
                            'A `macro` belongs at the top level of a file, not inside a folder.',
                            keyword(statement.span, 'macro'),
                        );
                    }
                    checkMacro(statement.name, statement.parameters, statement.body);
                    break;

                case 'ImportStatement':
                    checkMetadata(statement.metadata, 'import', scope);
                    break;

                case 'ImageStatement':
                    checkMetadata(statement.metadata, 'image', scope);
                    break;

                case 'TickerStatement':
                    if (inFolder) {
                        report(
                            'misplaced-ticker',
                            'The `ticker` belongs at the top level of a file, not inside a folder.',
                            keyword(statement.span, 'ticker'),
                        );
                    } else if (counts.ticker++ > 0) {
                        report(
                            'duplicate-ticker',
                            'A graph has one ticker; run both actions from the first as a run: `a -> 1, b -> 2`.',
                            keyword(statement.span, 'ticker'),
                        );
                    }
                    checkExpression(statement.handler, { ...scope, ticker: true });
                    checkMetadata(statement.metadata, 'ticker', scope);
                    break;

                case 'NoteStatement':
                    checkMetadata(statement.metadata, 'note', scope);
                    break;

                case 'ExpressionStatement':
                    checkStatementExpression(statement.expression, scope);
                    checkMetadata(statement.metadata, 'expression', scope);
                    break;

                case 'ErrorStatement':
                    break;
            }
        }
    };

    /**
     * A statement's expression, which may define a name: the name is checked
     * as a name being defined, and the parameters of a function are in scope
     * for its body.
     */
    const checkStatementExpression = (expression: Expression, scope: Scope): void => {
        // `theta = …` is neither a definition nor anything Desmos will draw:
        // it graphs r in terms of θ and never the reverse, and says so in a
        // cartesian graph as much as a polar one. The statement is still
        // written, and Desmos rejects it; this is so the author hears why
        // before it gets that far.
        if (
            expression.kind === 'Comparison' &&
            expression.operators.length === 1 &&
            expression.operators[0] === '=' &&
            expression.operands[0].kind === 'Identifier' &&
            expression.operands[0].name === 'theta'
        ) {
            report(
                'theta-equation',
                'Desmos cannot graph `theta` in terms of anything; write the curve as `r = …`.',
                expression.operands[0].span,
            );
        }

        const definition = definitionOf(expression);
        if (!definition) {
            stand(expression);
            checkExpression(expression, scope);
            return;
        }

        const name = definition.name.name;
        if (RESERVED_NAMES.has(name)) {
            report(
                'assign-to-builtin',
                AXIS_FUNCTION_NAME_SET.has(name)
                    ? `\`${name}\` is a built-in function and cannot be redefined.`
                    : `\`${name}\` is built in and cannot be redefined.`,
                definition.name.span,
            );
        }
        checkSubscripts(definition.name);
        checkToken(definition.name);

        const bound = new Set(scope.bound);
        if (definition.kind === 'function') {
            for (const parameter of definition.parameters) {
                checkSubscripts(parameter);
                bound.add(parameter.name);
            }
        }
        checkExpression(definition.value, { ...scope, bound });
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Macros
    // ─────────────────────────────────────────────────────────────────────────

    const checkMacro = (
        name: Identifier,
        parameters: readonly Identifier[] | null,
        body: Expression,
    ): void => {
        const macro = symbols.macros.get(name.name);
        // A second definition, or one whose name collides with another, was
        // reported when the symbols were gathered and is not the one any use
        // expands to - so it is not checked.
        if (macro?.statement.name !== name) {
            return;
        }

        if (recursive.has(name.name)) {
            report(
                'macro-recursion',
                `The macro \`${name.name}\` uses itself${recursive.get(name.name)}, so it never finishes expanding.`,
                name.span,
            );
        }

        const bound = new Set(parameters?.map(parameter => parameter.name));
        stand(body);
        checkExpression(body, { file, bound, ticker: false, macro: true });
    };

    /**
     * The macros that expand into themselves, directly or round a loop, with
     * the loop spelt out for the message.
     */
    const recursive = findRecursiveMacros(symbols);

    // ─────────────────────────────────────────────────────────────────────────
    // Expressions
    // ─────────────────────────────────────────────────────────────────────────

    const checkExpression = (node: Expression, scope: Scope): void => {
        switch (node.kind) {
            case 'String':
                report(
                    'unexpected-string',
                    'A string is not a value an expression can use; only a note, a label or a name is written in quotes.',
                    node.span,
                );
                return;

            case 'Identifier':
                checkIdentifier(node, scope);
                return;

            case 'Comparison':
                if (node.operators.includes('~') && !standing.has(node)) {
                    report(
                        'statement-only',
                        'A regression is a statement of its own - `ys ~ m xs + b` - and cannot be part of anything else.',
                        node.span,
                    );
                }
                for (const operand of node.operands) {
                    checkExpression(operand, scope);
                }
                return;

            case 'Call':
                if (isChart(node) && !standing.has(node)) {
                    report(
                        'statement-only',
                        `\`${node.callee.name}\` draws a chart, and is a statement of its own; it cannot be assigned or used in an expression.`,
                        node.span,
                    );
                }
                checkCall(node, scope);
                for (const arg of node.arguments) {
                    checkExpression(arg, scope);
                }
                return;

            case 'Prime':
                checkCall(node, scope);
                for (const arg of node.arguments) {
                    checkExpression(arg, scope);
                }
                return;

            case 'Member':
                // `z.real` is `real(z)` written after it (§5.4), and as much
                // an error outside complex mode.
                checkComplex(node.name.name, node.name, scope);
                checkCalculator(node.name.name, node.name);
                checkExpression(node.target, scope);
                if (node.arguments) {
                    checkMemberCall(node.name);
                    for (const arg of node.arguments) {
                        checkExpression(arg, scope);
                    }
                }
                return;

            case 'BigOperator': {
                // The bounds are read outside the variable, as Desmos reads
                // them, and the body inside it. A name already bound here - a
                // parameter, a binding, the variable of a sum around this one -
                // Desmos will not take as the variable, though a variable the
                // file defines it shadows without a word.
                checkSubscripts(node.variable);
                if (scope.bound.has(node.variable.name)) {
                    report(
                        'rebound-variable',
                        `\`${node.variable.name}\` is already bound here, so it cannot also be the variable of this \`${node.operator}\`; choose another name.`,
                        node.variable.span,
                    );
                }
                checkExpression(node.from, scope);
                checkExpression(node.to, scope);
                const bound = new Set(scope.bound).add(node.variable.name);
                checkExpression(node.body, { ...scope, bound });
                return;
            }

            case 'Derivative':
                checkSubscripts(node.variable);
                checkExpression(node.body, scope);
                return;

            case 'With':
            case 'For': {
                // A binding's value is read outside the bindings, and the body
                // inside them.
                const bound = new Set(scope.bound);
                for (const binding of node.bindings) {
                    checkSubscripts(binding.name);
                    checkExpression(binding.value, scope);
                    bound.add(binding.name.name);
                }
                checkExpression(node.body, { ...scope, bound });
                return;
            }

            default:
                for (const child of childrenOf(node)) {
                    checkExpression(child, scope);
                }
        }
    };

    const checkIdentifier = (node: Identifier, scope: Scope): void => {
        checkSubscripts(node);
        if (!checkToken(node)) {
            return;
        }
        if (scope.bound.has(node.name)) {
            return;
        }

        if (node.name === 'true' || node.name === 'false') {
            // Desmos has no booleans: `true` is t·r·u·e to it, and a graph
            // with one in simply asks for four sliders.
            report(
                'boolean-in-expression',
                `Desmos has no booleans, so \`${node.name}\` means nothing in an expression; use 1 and 0, or a condition such as \`a > 0\`.`,
                node.span,
            );
            return;
        }

        if (node.name === 'dt' && !scope.ticker && !scope.macro) {
            report(
                'dt-outside-ticker',
                '`dt` is the time since the ticker last ran, and exists only in the ticker’s handler.',
                node.span,
            );
            return;
        }

        const macro = symbols.macros.get(node.name);
        if (macro?.parameters) {
            report(
                'macro-arity',
                `The macro \`${node.name}\` takes ${count(macro.parameters.length, 'argument')}: ${node.name}(${macro.parameters.join(', ')}).`,
                node.span,
            );
        }
    };

    /**
     * `f(…)`: a builtin, a function the file defines, a macro - or a product
     * written like a call, which is legal only where it could be one (spec
     * §5.3). A name Desmos would read as a variable and a single argument make
     * a product: `a(b + 1)`, `k(x - 1)`. Anything else is an unknown function,
     * because Desmos would read it as a product in silence and nobody who
     * wrote `sine(x)` meant that.
     */
    const checkCall = (node: Call | Prime, scope: Scope): void => {
        const name = node.callee.name;
        checkSubscripts(node.callee);

        // `f'(x)` differentiates a function, so there has to be one: never a
        // product, and never a macro, which is gone by the time Desmos looks.
        if (node.kind === 'Prime') {
            if (!AXIS_FUNCTION_NAME_SET.has(name) && !symbols.functions.has(name)) {
                report(
                    'unknown-function',
                    `\`${name}${"'".repeat(node.order)}\` differentiates a function, and \`${name}\` is not one.`,
                    node.callee.span,
                );
            }
            return;
        }

        if (scope.bound.has(name)) {
            if (node.arguments.length !== 1) {
                report(
                    'unknown-function',
                    `\`${name}\` is a parameter, not a function, so it cannot be called with ${count(node.arguments.length, 'argument')}.`,
                    node.callee.span,
                );
            } else {
                products.add(node);
            }
            return;
        }

        const macro = symbols.macros.get(name);
        if (macro) {
            if (macro.parameters === null) {
                report(
                    'macro-arity',
                    `The macro \`${name}\` takes no arguments and is used without parentheses: \`${name}\`.`,
                    node.span,
                );
            } else if (macro.parameters.length !== node.arguments.length) {
                report(
                    'macro-arity',
                    `The macro \`${name}\` takes ${count(macro.parameters.length, 'argument')}, not ${node.arguments.length}: ${name}(${macro.parameters.join(', ')}).`,
                    node.span,
                );
            }
            return;
        }

        if (symbols.functions.has(name)) {
            return;
        }
        if (AXIS_FUNCTION_NAME_SET.has(name)) {
            checkComplex(name, node.callee, scope);
            checkCalculator(name, node.callee);
            return;
        }

        if (node.arguments.length === 1 && readsAsVariable(name, symbols)) {
            products.add(node);
            return;
        }

        report(
            'unknown-function',
            symbols.variables.has(name)
                ? `\`${name}\` is a variable, not a function, so it cannot be called with ${count(node.arguments.length, 'argument')}.`
                : `\`${name}\` is not a function - neither a built-in one nor one this file defines.`,
            node.callee.span,
        );
    };

    /**
     * `$12` in a graph for any calculator but the geometry one. A token names
     * a construction in that calculator's hidden folder, which no other
     * calculator has. Says whether the name is fine.
     */
    const checkToken = (node: Identifier): boolean => {
        if (!node.name.startsWith('$') || calculator === 'GEOMETRY') {
            return true;
        }
        report(
            'requires-calculator',
            `\`${node.name}\` is a geometry token, which exists only on the geometry calculator; draw on it with \`config { calculator: GEOMETRY }\`.`,
            node.span,
        );
        return false;
    };

    /**
     * `D.cdf(1)`: a member called is a built-in called with the member's
     * target first (§5.4), so it has to name one. `P.x(2)` is the coordinate
     * times 2, and `P.x(1, 2)` times the point, as they always were; anything
     * else is as unknown as `sine(x)`.
     */
    const checkMemberCall = (name: Identifier): void => {
        if (AXIS_FUNCTION_NAME_SET.has(name.name) || COORDINATES.has(name.name)) {
            return;
        }
        report(
            'unknown-function',
            `\`.${name.name}(…)\` calls a member, and \`${name.name}\` is not a built-in function.`,
            name.span,
        );
    };

    /**
     * `segment(A, B)` in a graph for a calculator that has no `segment`, which
     * Desmos rejects: "This calculator does not support the 'segment'
     * function."
     */
    const checkCalculator = (name: string, at: Identifier): void => {
        const calculators = FUNCTION_CALCULATORS.get(name);
        if (calculators && !calculators.includes(calculator)) {
            report(
                'requires-calculator',
                `\`${name}\` exists only on the ${list(calculators.map(named => CALCULATOR_NAMES[named]))} calculator; draw on it with \`config { calculator: ${calculators[0]} }\`.`,
                at.span,
            );
        }
    };

    /**
     * `real(z)` in a graph that is not in complex mode, which Desmos rejects:
     * "The 'real' function is only available in complex mode."
     */
    const checkComplex = (name: string, at: Identifier, scope: Scope): void => {
        if (
            AXIS_COMPLEX_FUNCTION_NAMES.has(name) &&
            !complexMode &&
            !scope.bound.has(name) &&
            !symbols.functions.has(name)
        ) {
            report(
                'requires-complex-mode',
                `\`${name}\` is only known in complex mode; turn it on with \`config { allowComplex: true }\`.`,
                at.span,
            );
        }
    };

    /**
     * `x_1_2`: the lexer reads more than one subscript as one name, so that
     * an enum value like `LOOP_FORWARD_REVERSE` can be written - but in an
     * expression Desmos has one subscript a name, and there is no spelling of
     * the second.
     */
    const checkSubscripts = (node: Identifier): void => {
        if ((node.name.match(/_/g)?.length ?? 0) > 1) {
            report(
                'multiple-subscripts',
                `\`${node.name}\` has more than one subscript; a name in an expression has at most one, as in \`x_12\`.`,
                node.span,
            );
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Properties
    // ─────────────────────────────────────────────────────────────────────────

    const checkMetadata = (
        metadata: Metadata | null,
        placement: PropertyPlacement,
        scope: Scope,
    ): void => {
        if (metadata) {
            checkProperties(metadata.entries, placement, scope);
        }
    };

    const checkProperties = (
        entries: readonly Property[],
        placement: PropertyPlacement,
        scope: Scope,
    ): void => {
        const seen = new Set<string>();

        for (const property of entries) {
            const name = property.key.name;
            const definition = findProperty(name, placement);

            if (!definition) {
                const elsewhere = placementsOf(name);
                if (elsewhere.length > 0) {
                    report(
                        'misplaced-property',
                        `\`${name}\` does not go on ${PLACEMENT_NOUNS[placement]}; it belongs on ${list(elsewhere.map(where => PLACEMENT_NOUNS[where]))}.`,
                        property.key.span,
                    );
                } else {
                    report(
                        'unknown-property',
                        `There is no property called \`${name}\`.`,
                        property.key.span,
                    );
                }
                continue;
            }

            if (seen.has(name) && !definition.repeatable) {
                report(
                    'duplicate-property',
                    `\`${name}\` is given twice here; only the last would count.`,
                    property.key.span,
                );
            }
            seen.add(name);

            checkValue(property, definition, placement, scope);
        }
    };

    /** Whether a property's value is the kind the manifest says it takes (spec §4.2). */
    const checkValue = (
        property: Property,
        definition: PropertyDefinition,
        placement: PropertyPlacement,
        scope: Scope,
    ): void => {
        const name = definition.name;
        const value = property.value;

        if (value === null) {
            // `key:` with nothing after it is the parser's to report; a bare
            // key is a flag, which only a boolean can be.
            if (!property.colon && definition.valueType !== 'boolean') {
                report(
                    'invalid-value',
                    `\`${name}\` needs a value: \`${name}: …\`.`,
                    property.span,
                );
            }
            return;
        }

        if (value.kind === 'Range') {
            if (definition.valueType !== 'range') {
                report(
                    'unexpected-range',
                    `\`${name}\` does not take a range; only a slider and a domain do.`,
                    value.span,
                );
                return;
            }
            if (name !== 'slider' && (value.step !== null || value.soft !== 'none')) {
                report(
                    'invalid-value',
                    `A domain is two ends and nothing else; \`step\` and \`soft\` belong to a slider.`,
                    value.span,
                );
            }
            for (const end of [value.min, value.max, value.step]) {
                if (end) {
                    checkExpression(end, scope);
                }
            }
            return;
        }

        switch (definition.valueType) {
            case 'expression':
                if (value.kind === 'String') {
                    report(
                        'invalid-value',
                        `\`${name}\` takes an expression, not a string.`,
                        value.span,
                    );
                } else {
                    checkExpression(value, scope);
                }
                return;

            case 'action':
                if (['Number', 'String', 'Color'].includes(value.kind)) {
                    report(
                        'invalid-value',
                        `\`${name}\` takes an action - \`a -> a + 1\` - or a run of them, or the name of one.`,
                        value.span,
                    );
                } else {
                    checkExpression(value, scope);
                }
                return;

            case 'number':
                if (!isNumberLiteral(value)) {
                    report('invalid-value', `\`${name}\` takes a number.`, value.span);
                }
                return;

            case 'string':
                if (value.kind !== 'String') {
                    report('invalid-value', `\`${name}\` takes a string, in quotes.`, value.span);
                }
                return;

            case 'boolean':
                if (
                    value.kind !== 'Identifier' ||
                    (value.name !== 'true' && value.name !== 'false')
                ) {
                    report(
                        'invalid-value',
                        `\`${name}\` is true or false - or written on its own, which means true.`,
                        value.span,
                    );
                }
                return;

            case 'enum':
                if (
                    value.kind !== 'Identifier' ||
                    enumValue(definition, value.name) === undefined
                ) {
                    report(
                        'invalid-enum',
                        `\`${name}\` is one of ${list(definition.values ?? [], 'or')}.`,
                        value.span,
                    );
                }
                return;

            case 'color':
                checkColor(value, name, placement === 'config', scope);
                return;

            case 'style':
                checkUse(value, placement);
                return;

            case 'name':
                if (value.kind !== 'Identifier') {
                    report(
                        'invalid-value',
                        `\`${name}\` takes a name, such as \`e1\`.`,
                        value.span,
                    );
                } else {
                    checkSubscripts(value);
                }
                return;

            case 'range':
                report(
                    'invalid-value',
                    `\`${name}\` takes a range, such as \`${name === 'slider' ? '0..10 step 1' : '0..2pi'}\`.`,
                    value.span,
                );
                return;
        }
    };

    /**
     * A colour (spec §4.3): a hex literal, a palette name, or any other
     * expression - which becomes `colorLatex` and is Desmos' to evaluate. The
     * config colours are hex strings to Desmos, so they take no expression.
     */
    const checkColor = (value: Expression, name: string, config: boolean, scope: Scope): void => {
        if (value.kind === 'Color') {
            return;
        }

        if (value.kind === 'Identifier') {
            if (AXIS_PALETTE_HEX.has(value.name)) {
                return;
            }
            // `red` is not a palette name, and unless the file defines it
            // is not a colour of any other kind: as an expression it would be
            // r·e·d. Said here rather than left as three sliders.
            const palette = [...AXIS_PALETTE_HEX.keys()].find(
                colour => colour.toLowerCase() === value.name.toLowerCase(),
            );
            if (palette && !symbols.variables.has(value.name) && !scope.bound.has(value.name)) {
                report(
                    'invalid-color',
                    `\`${value.name}\` is not a colour; the palette's names are capitalised: \`${palette}\`.`,
                    value.span,
                );
                return;
            }
        }

        if (config) {
            report(
                'invalid-color',
                `\`${name}\` takes a hex colour such as \`#2d70b3\` or a palette name - ${list([...AXIS_PALETTE_HEX.keys()], 'or')}.`,
                value.span,
            );
            return;
        }

        if (['Number', 'String', 'Sequence', 'Action', 'Comparison'].includes(value.kind)) {
            report(
                'invalid-color',
                `\`${name}\` takes a colour: a hex literal, a palette name, or an expression such as \`rgb(255, 0, 0)\`.`,
                value.span,
            );
            return;
        }

        checkExpression(value, scope);
    };

    /** `use: name` - a style that exists, whose properties go where it is used. */
    const checkUse = (value: Expression, placement: PropertyPlacement): void => {
        if (value.kind !== 'Identifier') {
            report('invalid-value', '`use` takes the name of a style.', value.span);
            return;
        }

        const style = symbols.styles.get(value.name);
        if (!style) {
            report('unknown-style', `There is no style called \`${value.name}\`.`, value.span);
            return;
        }

        // A style is checked as a style where it is defined; what it cannot
        // know there is where it will be used. `showLabel` is a fine thing for
        // a style to set, and meaningless on a table column.
        if (placement === 'style') {
            return;
        }
        const use = { value } as Property;
        for (const name of styleProperties(use, symbols.styles, []).keys()) {
            if (!findProperty(name, placement)) {
                report(
                    'misplaced-property',
                    `The style \`${value.name}\` sets \`${name}\`, which does not go on ${PLACEMENT_NOUNS[placement]}.`,
                    value.span,
                );
            }
        }
    };

    for (const current of program.files) {
        checkFile(current);
    }

    // Styles that use themselves are reported once per loop, against the `use:`
    // that closes it.
    for (const cycle of findStyleCycles(symbols)) {
        file = cycle.file;
        report(
            'style-cycle',
            `The style \`${cycle.style}\` uses itself: ${cycle.loop}.`,
            cycle.span,
        );
    }

    return { diagnostics, products };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether Desmos would read `name(…)` with one argument as a product: a name
 * that is a value rather than a function - a variable the file defines, a
 * constant, or a single letter, which is how anybody writes a coefficient.
 * A longer name nobody defined is far more likely a misspelt function.
 */
function readsAsVariable(name: string, symbols: Symbols): boolean {
    const head = name.split('_')[0];
    return (
        head.length === 1 ||
        // A geometry token names a value, as one letter does.
        name.startsWith('$') ||
        symbols.variables.has(name) ||
        AXIS_CONSTANT_NAME_SET.has(name) ||
        AXIS_OPERATOR_NAME_SET.has(name)
    );
}

function isEquation(node: Expression): boolean {
    return node.kind === 'Comparison';
}

/** `3`, `-0.5`: what a `number` property takes (spec §4.2). */
export function isNumberLiteral(node: Expression): boolean {
    return node.kind === 'Number' || (node.kind === 'Unary' && node.operand.kind === 'Number');
}

/** The span of a statement's leading keyword, which is what a placement error is about. */
function keyword(span: Span, word: string): Span {
    return { start: span.start, end: span.start + word.length };
}

function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function list(items: readonly string[], conjunction = 'or'): string {
    const quoted = items.map(item => (item.includes(' ') ? item : `\`${item}\``));
    if (quoted.length <= 1) return quoted.join('');
    return `${quoted.slice(0, -1).join(', ')} ${conjunction} ${quoted[quoted.length - 1]}`;
}

/**
 * Every macro whose expansion reaches itself, with the loop it goes round:
 * ` (A -> B -> A)`, or nothing for a macro that uses itself directly.
 */
function findRecursiveMacros(symbols: Symbols): Map<string, string> {
    const uses = new Map<string, string[]>();
    for (const macro of symbols.macros.values()) {
        const parameters = new Set(macro.parameters);
        const names: string[] = [];
        const visit = (node: Expression): void => {
            const name =
                node.kind === 'Identifier'
                    ? node.name
                    : node.kind === 'Call'
                      ? node.callee.name
                      : undefined;
            if (name && !parameters.has(name) && symbols.macros.has(name)) {
                names.push(name);
            }
            childrenOf(node).forEach(visit);
        };
        visit(macro.body);
        uses.set(macro.name, names);
    }

    const recursive = new Map<string, string>();
    for (const start of uses.keys()) {
        // Depth-first from each macro, looking for a way back to it.
        const path: string[] = [start];
        const seen = new Set<string>();
        const search = (name: string): boolean => {
            for (const next of uses.get(name) ?? []) {
                if (next === start) {
                    path.push(next);
                    return true;
                }
                if (!seen.has(next)) {
                    seen.add(next);
                    path.push(next);
                    if (search(next)) return true;
                    path.pop();
                }
            }
            return false;
        };
        if (search(start)) {
            recursive.set(start, path.length > 2 ? ` (${path.join(' -> ')})` : '');
        }
    }
    return recursive;
}

/**
 * Each loop of styles using styles, found once and reported against the
 * `use:` that closes it.
 */
function findStyleCycles(
    symbols: Symbols,
): { style: string; loop: string; span: Span; file: SourceFile }[] {
    const cycles: { style: string; loop: string; span: Span; file: SourceFile }[] = [];
    const done = new Set<string>();

    const visit = (name: string, path: string[]): void => {
        const style = symbols.styles.get(name);
        if (!style || done.has(name)) {
            return;
        }
        for (const entry of style.entries) {
            if (entry.key.name !== 'use' || entry.value?.kind !== 'Identifier') {
                continue;
            }
            const next = entry.value.name;
            const at = path.indexOf(next);
            if (at !== -1) {
                cycles.push({
                    style: next,
                    loop: [...path.slice(at), name, next].join(' -> '),
                    span: entry.value.span,
                    file: style.file,
                });
            } else if (next !== name) {
                visit(next, [...path, name]);
            } else {
                cycles.push({
                    style: name,
                    loop: `${name} -> ${name}`,
                    span: entry.value.span,
                    file: style.file,
                });
            }
        }
        done.add(name);
    };

    for (const name of symbols.styles.keys()) {
        visit(name, []);
    }
    return cycles;
}

/**
 * Whether the graph will be in complex mode: `allowComplex: true` in a config
 * block, the entry file's winning over an imported one's as it does when the
 * blocks are merged. A block inside a folder is misplaced and lowers to
 * nothing, so it says nothing here either.
 */
function allowsComplex(program: Program): boolean {
    const value = configEntry(program, 'allowComplex');
    return value === null || (value?.kind === 'Identifier' && value.name === 'true');
}

/** The calculator the graph is for, `GRAPHING` unless a config block says. */
function calculatorOf(program: Program): string {
    const value = configEntry(program, 'calculator');
    const definition = findProperty('calculator', 'config');
    const named =
        value?.kind === 'Identifier' && definition ? enumValue(definition, value.name) : undefined;
    return named ?? 'GRAPHING';
}

/**
 * The value a config block gives `key` - `null` for a bare flag - with the
 * entry file's winning over an imported one's, as it does when the blocks are
 * merged, or undefined when none gives it.
 */
function configEntry(program: Program, key: string): PropertyValue | null | undefined {
    let imported: PropertyValue | null | undefined;
    let entry: PropertyValue | null | undefined;
    for (const file of program.files) {
        for (const statement of file.tree.file.statements) {
            if (statement.kind !== 'ConfigStatement') continue;
            for (const property of statement.entries) {
                if (property.key.name !== key) continue;
                if (file.entry) entry = property.value;
                else imported = property.value;
            }
        }
    }
    return entry !== undefined ? entry : imported;
}
