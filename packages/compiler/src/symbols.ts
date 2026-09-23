// ═════════════════════════════════════════════════════════════════════════════
// Symbols - the names a compilation defines, across every file it reads
// ═════════════════════════════════════════════════════════════════════════════
//
// Four namespaces, all global to the compilation (spec §4.5, §6): macros,
// styles, and the functions and variables the file defines. Global because
// that is how the language reads - a macro or a style is in scope above where
// it is written and in every file an import brings in, and a function defined
// in one file is called from another - so they are gathered from the whole
// import graph before any file is checked or lowered.
//
// Macros and styles come first, straight off the statements that define them.
// Definitions come second, and through the expander: a macro may stand for a
// whole equation, so what a statement defines is only known once any macro in
// it has been replaced by what it stands for.

import {
    AXIS_BUILTIN_NAMES,
    AXIS_CONSTANT_NAME_SET,
    AXIS_FUNCTION_NAME_SET,
    AXIS_OPERATOR_NAME_SET,
    type Diagnostic,
    type Expression,
    type Identifier,
    type MacroStatement,
    type Property,
    type StyleStatement,
} from '@axis-dsl/syntax';
import { expandMacros } from './macros';
import { located, type Program, type SourceFile } from './program';
import { forEachStatement } from './walk';

export interface MacroDefinition {
    name: string;
    /** Null for `macro TAU = …`, used bare; a list for one used as a call. */
    parameters: string[] | null;
    body: Expression;
    statement: MacroStatement;
    file: SourceFile;
}

export interface StyleDefinition {
    name: string;
    entries: Property[];
    statement: StyleStatement;
    file: SourceFile;
}

export interface Symbols {
    macros: Map<string, MacroDefinition>;
    styles: Map<string, StyleDefinition>;
    /** Every name defined as a function, `f(x) = …`, in any file. */
    functions: Set<string>;
    /** Every name defined as a value, `a = …`, or as a table column, in any file. */
    variables: Set<string>;
}

/**
 * What an expression statement defines, if anything (spec §5.5).
 *
 * `f(x) = …` on fresh identifiers is a function; `a = …` is a variable, unless
 * `a` is one of the names Desmos reads as a coordinate - then it is an equation,
 * `x = 3` being the vertical line.
 */
export type Definition =
    | { kind: 'variable'; name: Identifier; value: Expression }
    | { kind: 'function'; name: Identifier; parameters: Identifier[]; value: Expression };

/** The names that make `name = …` an equation rather than a definition. */
const COORDINATES: ReadonlySet<string> = new Set(['x', 'y', 'r', 'theta']);

export function definitionOf(expression: Expression): Definition | undefined {
    if (
        expression.kind !== 'Comparison' ||
        expression.operators.length !== 1 ||
        expression.operators[0] !== '='
    ) {
        return undefined;
    }

    const [left, value] = expression.operands;
    if (left.kind === 'Identifier' && !COORDINATES.has(left.name)) {
        return { kind: 'variable', name: left, value };
    }
    if (left.kind === 'Call' && left.arguments.every(arg => arg.kind === 'Identifier')) {
        return {
            kind: 'function',
            name: left.callee,
            parameters: left.arguments as Identifier[],
            value,
        };
    }
    return undefined;
}

/**
 * The names a file may not define for itself: every function and operator,
 * and the constants that are values rather than letters.
 *
 * The Greek letters are in the manifest as constants, but to Desmos they are
 * letters like any other - `alpha = 2` is a variable called α. `pi`, `tau`, `e`
 * and `infinity` are not: Desmos reads `\pi=3` as an equation that is simply
 * false, and draws nothing without a word. `theta` is left to the definition
 * rule, which reads `theta = …` as polar.
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
    ...AXIS_FUNCTION_NAME_SET,
    ...AXIS_OPERATOR_NAME_SET,
    ...['pi', 'tau', 'e', 'infinity', 'true', 'false'].filter(name =>
        AXIS_CONSTANT_NAME_SET.has(name),
    ),
]);

/**
 * Gather every macro, style and definition in the program, reporting a macro
 * or a style defined twice. The first definition is the one that stands.
 */
export function collectSymbols(program: Program): { symbols: Symbols; diagnostics: Diagnostic[] } {
    const diagnostics: Diagnostic[] = [];
    const symbols: Symbols = {
        macros: new Map(),
        styles: new Map(),
        functions: new Set(),
        variables: new Set(),
    };

    for (const file of program.files) {
        forEachStatement(file.tree.file.statements, statement => {
            if (statement.kind === 'MacroStatement') {
                const name = statement.name.name;
                const existing = symbols.macros.get(name);
                if (existing) {
                    diagnostics.push(
                        located(
                            {
                                code: 'duplicate-macro',
                                severity: 'error',
                                message: `The macro \`${name}\` is defined twice${elsewhere(existing.file, file)}.`,
                                span: statement.name.span,
                            },
                            file,
                        ),
                    );
                    return;
                }
                symbols.macros.set(name, {
                    name,
                    parameters: statement.parameters?.map(parameter => parameter.name) ?? null,
                    body: statement.body,
                    statement,
                    file,
                });
            } else if (statement.kind === 'StyleStatement') {
                const name = statement.name.name;
                const existing = symbols.styles.get(name);
                if (existing) {
                    diagnostics.push(
                        located(
                            {
                                code: 'duplicate-style',
                                severity: 'error',
                                message: `The style \`${name}\` is defined twice${elsewhere(existing.file, file)}.`,
                                span: statement.name.span,
                            },
                            file,
                        ),
                    );
                    return;
                }
                symbols.styles.set(name, { name, entries: statement.entries, statement, file });
            }
        });
    }

    // A macro named after a builtin would take the builtin's place in every
    // expression that used it - `macro sin = 3` breaks every `sin(x)` in the
    // compilation - so it is reported and left out, and the builtin keeps its
    // meaning. Done before the definitions are read, since reading them
    // expands macros.
    for (const [name, macro] of symbols.macros) {
        if (AXIS_BUILTIN_NAMES.has(name)) {
            diagnostics.push(
                collision(macro, `A macro cannot be called \`${name}\`, which is built in.`),
            );
            symbols.macros.delete(name);
        }
    }

    for (const file of program.files) {
        forEachStatement(file.tree.file.statements, statement => {
            if (statement.kind === 'ExpressionStatement') {
                // As written first: `a = 1` defines `a` even with a macro of
                // that name about, which is the collision reported below.
                const definition =
                    definitionOf(statement.expression) ??
                    definitionOf(expandMacros(statement.expression, symbols.macros).expression);
                if (definition?.kind === 'function') {
                    symbols.functions.add(definition.name.name);
                } else if (definition?.kind === 'variable') {
                    symbols.variables.add(definition.name.name);
                }
            } else if (statement.kind === 'TableStatement') {
                for (const column of statement.columns) {
                    if (column.values !== null && column.header.kind === 'Identifier') {
                        symbols.variables.add(column.header.name);
                    }
                }
            }
        });
    }

    // The same for a macro with the name of something the file defines: the
    // name keeps meaning the function or the variable, which is what the rest
    // of the file was written against.
    for (const [name, macro] of symbols.macros) {
        const kind = symbols.functions.has(name)
            ? 'function'
            : symbols.variables.has(name)
              ? 'variable'
              : undefined;
        if (kind) {
            diagnostics.push(
                collision(
                    macro,
                    `The macro \`${name}\` has the name of a ${kind} the file defines; a macro shadows nothing.`,
                ),
            );
            symbols.macros.delete(name);
        }
    }

    return { symbols, diagnostics };
}

function collision(macro: MacroDefinition, message: string): Diagnostic {
    return located(
        { code: 'macro-collision', severity: 'error', message, span: macro.statement.name.span },
        macro.file,
    );
}

/** `, first in lib/waves.axis` - where the other definition is, if not here. */
function elsewhere(first: SourceFile, second: SourceFile): string {
    if (first === second) {
        return '';
    }
    return first.entry ? ' - first in the file itself' : ` - first in ${first.path}`;
}
