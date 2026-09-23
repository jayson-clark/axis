// ═════════════════════════════════════════════════════════════════════════════
// Symbols - what every name in a file refers to
// ═════════════════════════════════════════════════════════════════════════════
//
// One walk over the tree classifies every identifier in it: a property key, an
// enum value, a style named by `use:`, or a name in an expression - and then
// which definition that name means, or which builtin. Hover, go-to-definition,
// references, highlights and semantic tokens all read this one answer, so they
// cannot disagree about what `a` is.
//
// It is syntactic, and deliberately so: the checker (#17) decides whether a
// definition is legal, and this only has to know where one was written.
// `name = …` and `f(a, b) = …` define, anywhere a statement can stand - which
// includes inside a folder, since a folder is not a scope; `macro` and `style`
// define in namespaces of their own. A function's parameters are in scope in
// its body, a macro's in its body, and a `with` or `for` binding in the
// expression it binds for.

import {
    AXIS_CONSTANT_NAME_SET,
    AXIS_FUNCTION_NAME_SET,
    AXIS_OPERATOR_NAME_SET,
    AXIS_PALETTE_HEX,
    enumValue,
    findProperty,
    type PropertyDefinition,
    type PropertyPlacement,
    type Span,
    type SyntaxTree,
} from '@axis-dsl/syntax';
import type * as ast from '@axis-dsl/syntax';
import { definitionOf } from '@axis-dsl/compiler';
import { touches } from './document';

export type SymbolKind = 'variable' | 'function' | 'macro' | 'style' | 'parameter' | 'binding';

/**
 * Which names a definition competes with. Styles live in their own namespace
 * (spec §4.5); macros may not share a name with anything, but are looked up
 * first because they are what expands.
 */
export type SymbolNamespace = 'value' | 'macro' | 'style';

/** Something the file itself defines. */
export interface SymbolDefinition {
    name: string;
    kind: SymbolKind;
    namespace: SymbolNamespace;
    /** The name as written at the definition. */
    identifier: ast.Identifier;
    /** The statement the definition is written in. */
    statement: ast.Statement;
    /** A function's or a macro's parameter names; absent for a parameterless macro. */
    parameters?: string[];
    /** For a parameter or binding: the function, macro or expression it belongs to. */
    owner?: SymbolDefinition;
    /** For a parameter or binding: where it is visible. Absent means the whole file. */
    scope?: Span;
    /** For a table column's header: the column, which is what defines it. */
    column?: ast.TableColumn;
}

export type BuiltinKind = 'function' | 'constant' | 'operator';

/**
 * - `name`: an identifier in an expression, or the name a definition gives
 * - `property`: a property key
 * - `enumValue`: an enum property's value, `DASHED`
 * - `palette`: a colour property's palette name, `RED`
 * - `styleName`: the value of `use:`
 * - `member`: the name after a `.`, `P.x` or `L.count`
 */
export type OccurrenceRole = 'name' | 'property' | 'enumValue' | 'palette' | 'styleName' | 'member';

/** One identifier in the tree, and what it is. */
export interface Occurrence {
    identifier: ast.Identifier;
    role: OccurrenceRole;
    /** Whether this is where the thing it names is defined. */
    declaration: boolean;
    /** The user definition it refers to, if it refers to one. */
    symbol?: SymbolDefinition;
    /** The builtin it names, when it names one rather than a user definition. */
    builtin?: BuiltinKind;
    /** Whether it is the callee of a call, `f` in `f(x)`. */
    callee: boolean;
    /** For a property key or value: the property, where the manifest has it. */
    property?: PropertyDefinition;
    placement?: PropertyPlacement;
    /** The statement it is written in. */
    statement: ast.Statement;
}

export interface Analysis {
    /** Every definition, in document order, locals included. */
    definitions: SymbolDefinition[];
    /** The file-wide definitions, by namespace and then name: the first of each name. */
    globals: Record<SymbolNamespace, ReadonlyMap<string, SymbolDefinition>>;
    /** Every identifier in the tree, in document order. */
    occurrences: Occurrence[];
}

/**
 * The column headers that name nothing: a table headed `x` and `y` plots its
 * points, where one headed `x_1` defines a list.
 */
const CURVE_VARIABLES: ReadonlySet<string> = new Set(['x', 'y', 'r', 'theta']);

const analyses = new WeakMap<SyntaxTree, Analysis>();

/** The tree's symbols, worked out once. */
export function analyze(tree: SyntaxTree): Analysis {
    let analysis = analyses.get(tree);
    if (!analysis) {
        analysis = new Analyzer().run(tree.file);
        analyses.set(tree, analysis);
    }
    return analysis;
}

/** The identifier under or just before the cursor, and what it is. */
export function occurrenceAt(tree: SyntaxTree, offset: number): Occurrence | undefined {
    const { occurrences } = analyze(tree);
    // Prefer the identifier the offset is inside over one that merely ends
    // where the next begins: `a+b` with the cursor between is on `b`.
    let touching: Occurrence | undefined;
    for (const occurrence of occurrences) {
        const span = occurrence.identifier.span;
        if (span.start > offset) break;
        if (span.start <= offset && offset < span.end) return occurrence;
        if (touches(span, offset)) touching = occurrence;
    }
    return touching;
}

/** Every occurrence that refers to `symbol`, its declarations included. */
export function occurrencesOf(tree: SyntaxTree, symbol: SymbolDefinition): Occurrence[] {
    return analyze(tree).occurrences.filter(occurrence => occurrence.symbol === symbol);
}

/**
 * What a `f(a, b) = …` or `a = …` statement defines, read off its left-hand
 * side: the name, and a function's parameters. Undefined for anything else.
 */
export function definitionShape(
    expression: ast.Expression,
): { name: ast.Identifier; parameters?: ast.Identifier[]; body: ast.Expression } | undefined {
    // The compiler's own reading, so the editor and a compile never disagree
    // about whether a statement defines something.
    const definition = definitionOf(expression);
    if (!definition) return undefined;
    return definition.kind === 'function'
        ? { name: definition.name, parameters: definition.parameters, body: definition.value }
        : { name: definition.name, body: definition.value };
}

/** The statements of a file, those inside folders included, in document order. */
export function* allStatements(statements: readonly ast.Statement[]): Generator<ast.Statement> {
    for (const statement of statements) {
        yield statement;
        if (statement.kind === 'FolderStatement') yield* allStatements(statement.body);
    }
}

type Scope = ReadonlyMap<string, SymbolDefinition>;

class Analyzer {
    private readonly definitions: SymbolDefinition[] = [];
    private readonly occurrences: Occurrence[] = [];
    private readonly globals: Record<SymbolNamespace, Map<string, SymbolDefinition>> = {
        value: new Map(),
        macro: new Map(),
        style: new Map(),
    };
    /** The global definition each defining identifier made, by its offset. */
    private readonly declared = new Map<number, SymbolDefinition>();
    private statement!: ast.Statement;

    run(file: ast.File): Analysis {
        // Every global is in scope everywhere - above where it is written, too -
        // so they are all gathered before any name is resolved.
        for (const statement of allStatements(file.statements)) this.collect(statement);

        for (const statement of file.statements) this.statementNode(statement);

        this.definitions.sort((a, b) => a.identifier.span.start - b.identifier.span.start);
        this.occurrences.sort((a, b) => a.identifier.span.start - b.identifier.span.start);
        return {
            definitions: this.definitions,
            globals: this.globals,
            occurrences: this.occurrences,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gathering the globals
    // ─────────────────────────────────────────────────────────────────────────

    private define(definition: SymbolDefinition): SymbolDefinition {
        this.definitions.push(definition);
        const table = this.globals[definition.namespace];
        // A second definition of a name is the checker's error to report;
        // here the first is the one the name means, and the second is another
        // place it is declared.
        const first = table.get(definition.name);
        if (!first) table.set(definition.name, definition);
        const meant = first ?? definition;
        this.declared.set(definition.identifier.span.start, meant);
        return meant;
    }

    private collect(statement: ast.Statement): void {
        switch (statement.kind) {
            case 'ExpressionStatement': {
                const shape = definitionShape(statement.expression);
                if (!shape) return;
                this.define({
                    name: shape.name.name,
                    kind: shape.parameters ? 'function' : 'variable',
                    namespace: 'value',
                    identifier: shape.name,
                    statement,
                    parameters: shape.parameters?.map(parameter => parameter.name),
                });
                return;
            }
            case 'MacroStatement':
                this.define({
                    name: statement.name.name,
                    kind: 'macro',
                    namespace: 'macro',
                    identifier: statement.name,
                    statement,
                    parameters: statement.parameters?.map(parameter => parameter.name),
                });
                return;
            case 'StyleStatement':
                if (statement.name.name === '') return;
                this.define({
                    name: statement.name.name,
                    kind: 'style',
                    namespace: 'style',
                    identifier: statement.name,
                    statement,
                });
                return;
            case 'TableStatement':
                for (const column of statement.columns) {
                    // `x_1 = [1, 2, 3]` names the column's list; a column
                    // headed `x` or `y` names nothing, it plots.
                    if (
                        column.values !== null &&
                        column.header.kind === 'Identifier' &&
                        !CURVE_VARIABLES.has(column.header.name)
                    ) {
                        this.define({
                            name: column.header.name,
                            kind: 'variable',
                            namespace: 'value',
                            identifier: column.header,
                            statement,
                            column,
                        });
                    }
                }
                return;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Walking
    // ─────────────────────────────────────────────────────────────────────────

    private record(occurrence: Omit<Occurrence, 'statement' | 'callee'> & { callee?: boolean }) {
        this.occurrences.push({ callee: false, ...occurrence, statement: this.statement });
    }

    private local(
        identifier: ast.Identifier,
        kind: 'parameter' | 'binding',
        scope: Span,
        owner?: SymbolDefinition,
    ): SymbolDefinition {
        const definition: SymbolDefinition = {
            name: identifier.name,
            kind,
            namespace: 'value',
            identifier,
            statement: this.statement,
            owner,
            scope,
        };
        this.definitions.push(definition);
        this.record({ identifier, role: 'name', declaration: true, symbol: definition });
        return definition;
    }

    /** Record a name a global definition gives, as the declaration it is. */
    private declaration(identifier: ast.Identifier, callee = false): SymbolDefinition | undefined {
        const symbol = this.declared.get(identifier.span.start);
        this.record({ identifier, role: 'name', declaration: true, symbol, callee });
        return symbol;
    }

    private statementNode(statement: ast.Statement): void {
        this.statement = statement;
        switch (statement.kind) {
            case 'ConfigStatement':
                statement.entries.forEach(entry => this.property(entry, 'config'));
                return;
            case 'FolderStatement':
                this.metadata(statement.metadata, 'folder');
                statement.body.forEach(child => this.statementNode(child));
                return;
            case 'TableStatement':
                this.metadata(statement.metadata, 'table');
                for (const column of statement.columns) {
                    this.statement = statement;
                    if (this.declared.has(column.header.span.start)) {
                        this.declaration(column.header as ast.Identifier);
                    } else {
                        this.expression(column.header, []);
                    }
                    column.values?.forEach(value => this.expression(value, []));
                    this.metadata(column.metadata, 'column');
                }
                return;
            case 'StyleStatement':
                if (statement.name.name !== '') this.declaration(statement.name);
                statement.entries.forEach(entry => this.property(entry, 'style'));
                return;
            case 'MacroStatement': {
                const macro = this.declaration(statement.name);
                const scope = new Map<string, SymbolDefinition>();
                for (const parameter of statement.parameters ?? []) {
                    scope.set(
                        parameter.name,
                        this.local(parameter, 'parameter', statement.body.span, macro),
                    );
                }
                this.expression(statement.body, [scope]);
                return;
            }
            case 'ImportStatement':
                this.metadata(statement.metadata, 'import');
                return;
            case 'ImageStatement':
                this.metadata(statement.metadata, 'image');
                return;
            case 'NoteStatement':
                this.metadata(statement.metadata, 'note');
                return;
            case 'TickerStatement':
                this.expression(statement.handler, []);
                this.metadata(statement.metadata, 'ticker');
                return;
            case 'ExpressionStatement': {
                const shape = definitionShape(statement.expression);
                if (shape) {
                    const owner = this.declaration(shape.name, shape.parameters !== undefined);
                    const scope = new Map<string, SymbolDefinition>();
                    for (const parameter of shape.parameters ?? []) {
                        scope.set(
                            parameter.name,
                            this.local(parameter, 'parameter', shape.body.span, owner),
                        );
                    }
                    this.expression(shape.body, [scope]);
                } else {
                    this.expression(statement.expression, []);
                }
                this.metadata(statement.metadata, 'expression');
                return;
            }
            case 'ErrorStatement':
                return;
        }
    }

    private metadata(metadata: ast.Metadata | null, placement: PropertyPlacement): void {
        metadata?.entries.forEach(entry => this.property(entry, placement));
    }

    private property(property: ast.Property, placement: PropertyPlacement): void {
        const definition =
            findProperty(property.key.name, placement) ?? findProperty(property.key.name);
        this.record({
            identifier: property.key,
            role: 'property',
            declaration: false,
            property: definition,
            placement,
        });

        const value = property.value;
        if (!value) return;
        if (value.kind === 'Range') {
            for (const end of [value.min, value.max, value.step]) {
                if (end) this.expression(end, []);
            }
            return;
        }

        if (value.kind === 'Identifier' && definition) {
            const named = {
                identifier: value,
                declaration: false,
                property: definition,
                placement,
            };
            if (definition.valueType === 'enum' && enumValue(definition, value.name)) {
                this.record({ ...named, role: 'enumValue' });
                return;
            }
            if (definition.valueType === 'color' && AXIS_PALETTE_HEX.has(value.name)) {
                this.record({ ...named, role: 'palette' });
                return;
            }
            if (definition.valueType === 'style') {
                this.record({
                    ...named,
                    role: 'styleName',
                    symbol: this.globals.style.get(value.name),
                });
                return;
            }
        }
        this.expression(value, []);
    }

    private name(identifier: ast.Identifier, scopes: readonly Scope[], callee: boolean): void {
        for (let i = scopes.length - 1; i >= 0; i--) {
            const local = scopes[i].get(identifier.name);
            if (local) {
                this.record({
                    identifier,
                    role: 'name',
                    declaration: false,
                    symbol: local,
                    callee,
                });
                return;
            }
        }
        const symbol =
            this.globals.macro.get(identifier.name) ?? this.globals.value.get(identifier.name);
        if (symbol) {
            this.record({ identifier, role: 'name', declaration: false, symbol, callee });
            return;
        }
        this.record({
            identifier,
            role: 'name',
            declaration: false,
            builtin: builtinKind(identifier.name),
            callee,
        });
    }

    private expression(node: ast.Expression, scopes: readonly Scope[]): void {
        switch (node.kind) {
            case 'Identifier':
                this.name(node, scopes, false);
                return;
            case 'Call':
                this.name(node.callee, scopes, true);
                node.arguments.forEach(argument => this.expression(argument, scopes));
                return;
            case 'Prime':
                this.name(node.callee, scopes, true);
                node.arguments.forEach(argument => this.expression(argument, scopes));
                return;
            case 'BigOperator': {
                // The variable is bound in the body alone: the bounds are read
                // where the `sum` stands, as Desmos reads them.
                this.name(node.name, scopes, true);
                this.expression(node.from, scopes);
                this.expression(node.to, scopes);
                const scope = new Map<string, SymbolDefinition>([
                    [node.variable.name, this.local(node.variable, 'binding', node.span)],
                ]);
                this.expression(node.body, [...scopes, scope]);
                return;
            }
            case 'Member': {
                this.expression(node.target, scopes);
                this.record({
                    identifier: node.name,
                    role: 'member',
                    declaration: false,
                    builtin: AXIS_FUNCTION_NAME_SET.has(node.name.name) ? 'function' : undefined,
                });
                return;
            }
            case 'With':
            case 'For': {
                // The values a binding takes are read where the `with` or `for`
                // stands; only the expression it binds for sees the names.
                const scope = new Map<string, SymbolDefinition>();
                for (const binding of node.bindings) {
                    this.expression(binding.value, scopes);
                    scope.set(binding.name.name, this.local(binding.name, 'binding', node.span));
                }
                this.expression(node.body, [...scopes, scope]);
                return;
            }
            default:
                for (const child of expressionChildren(node)) this.expression(child, scopes);
        }
    }
}

export function builtinKind(name: string): BuiltinKind | undefined {
    if (AXIS_FUNCTION_NAME_SET.has(name)) return 'function';
    if (AXIS_CONSTANT_NAME_SET.has(name)) return 'constant';
    if (AXIS_OPERATOR_NAME_SET.has(name)) return 'operator';
    return undefined;
}

/** The expressions directly inside one, for a walk that has nothing special to do with it. */
export function expressionChildren(node: ast.Expression): ast.Expression[] {
    switch (node.kind) {
        case 'Number':
        case 'Identifier':
        case 'String':
        case 'Color':
        case 'ErrorExpression':
            return [];
        case 'Paren':
        case 'Abs':
            return [node.expression];
        case 'Tuple':
        case 'List':
        case 'Sequence':
            return node.elements;
        case 'ListRange':
            return [node.from, node.to];
        case 'Piecewise':
            return [
                ...node.branches.flatMap(branch =>
                    branch.value ? [branch.condition, branch.value] : [branch.condition],
                ),
                ...(node.otherwise ? [node.otherwise] : []),
            ];
        case 'Unary':
            return [node.operand];
        case 'Binary':
            return [node.left, node.right];
        case 'Comparison':
            return node.operands;
        case 'Call':
        case 'Prime':
            return [node.callee, ...node.arguments];
        case 'BigOperator':
            return [node.name, node.variable, node.from, node.to, node.body];
        case 'Derivative':
            return [node.variable, node.body];
        case 'Index':
            return [node.target, node.index];
        case 'Member':
            return [node.target, node.name];
        case 'Factorial':
            return [node.operand];
        case 'Action':
            return [node.target, node.value];
        case 'With':
        case 'For':
            return [node.body, ...node.bindings.flatMap(binding => [binding.name, binding.value])];
    }
}
