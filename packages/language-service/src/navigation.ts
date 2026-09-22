// ═════════════════════════════════════════════════════════════════════════════
// Navigation - definitions, references, the outline, folding
// ═════════════════════════════════════════════════════════════════════════════
//
// All of it reads the symbol analysis, so "go to definition" and "find
// references" agree with the highlighting about what a name means: a
// parameter inside its function, the global of that name outside it.
//
// A name the file does not define may still be defined - by an import, since
// macros, styles and every definition are in scope across files (spec §6, §7).
// Given the compiler's `resolveImport`, `getDefinition` follows one there, to
// a location in the file the resolver named.

import { printExpression, type SyntaxTree } from '@axis-dsl/syntax';
import type * as ast from '@axis-dsl/syntax';
import {
    linesOf,
    offsetAt,
    spanToRange,
    toTree,
    type DocumentInput,
    type Position,
    type Range,
} from './document';
import { importedSymbol, type ProgramOptions } from './program';
import { analyze, definitionShape, occurrenceAt, occurrencesOf, type Occurrence } from './symbols';

/** A place a definition is written: in this document when `uri` is absent, else in the file the resolver named so. */
export interface Location {
    uri?: string;
    range: Range;
}

/** How to reach the files the document imports, for a name defined in one of them. */
export type DefinitionOptions = ProgramOptions;

/** Whether an occurrence names something a definition could be found for. */
const isReference = (occurrence: Occurrence) =>
    (occurrence.role === 'name' && !occurrence.builtin) || occurrence.role === 'styleName';

export function getDefinition(
    input: DocumentInput,
    position: Position,
    options: DefinitionOptions = {},
): Location[] {
    const tree = toTree(input);
    const occurrence = occurrenceAt(tree, offsetAt(tree, position));
    if (!occurrence || !isReference(occurrence)) return [];
    if (occurrence.symbol) {
        return [{ range: spanToRange(tree, occurrence.symbol.identifier.span) }];
    }
    const imported = importedSymbol(
        tree,
        options,
        occurrence.identifier.name,
        occurrence.role === 'styleName' ? 'style' : 'value',
    );
    if (!imported) return [];
    const { lines } = imported.file;
    const { span } = imported.identifier;
    return [
        {
            uri: imported.file.path,
            range: { start: lines.positionAt(span.start), end: lines.positionAt(span.end) },
        },
    ];
}

/** The occurrences that mean the same thing as the one at an offset. */
function related(tree: SyntaxTree, offset: number): Occurrence[] {
    const occurrence = occurrenceAt(tree, offset);
    if (!occurrence || !isReference(occurrence)) return [];
    if (occurrence.symbol) return occurrencesOf(tree, occurrence.symbol);
    // A name defined nowhere in the file - a slider Desmos will offer, or a
    // definition an import makes - still means one thing throughout it.
    return analyze(tree).occurrences.filter(
        other =>
            other.role === occurrence.role &&
            !other.symbol &&
            !other.builtin &&
            other.identifier.name === occurrence.identifier.name,
    );
}

export interface ReferenceOptions {
    /** Whether the definition itself is among the references. True by default. */
    includeDeclaration?: boolean;
}

/** Every place in the document the name at `position` is used. */
export function getReferences(
    input: DocumentInput,
    position: Position,
    options: ReferenceOptions = {},
): Range[] {
    const tree = toTree(input);
    return related(tree, offsetAt(tree, position))
        .filter(occurrence => options.includeDeclaration !== false || !occurrence.declaration)
        .map(occurrence => spanToRange(tree, occurrence.identifier.span));
}

export interface DocumentHighlight {
    range: Range;
    /** `write` where the name is defined, `read` where it is used. */
    kind: 'read' | 'write';
}

export function getDocumentHighlights(
    input: DocumentInput,
    position: Position,
): DocumentHighlight[] {
    const tree = toTree(input);
    return related(tree, offsetAt(tree, position)).map(occurrence => ({
        range: spanToRange(tree, occurrence.identifier.span),
        kind: occurrence.declaration ? 'write' : 'read',
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The outline
// ─────────────────────────────────────────────────────────────────────────────

export type DocumentSymbolKind =
    | 'folder'
    | 'table'
    | 'config'
    | 'style'
    | 'macro'
    | 'import'
    | 'image'
    | 'ticker'
    | 'note'
    | 'variable'
    | 'function'
    | 'property';

export interface DocumentSymbol {
    name: string;
    kind: DocumentSymbolKind;
    detail?: string;
    /** The whole statement. */
    range: Range;
    /** The part to reveal when the symbol is picked: its name, where it has one. */
    selectionRange: Range;
    children?: DocumentSymbol[];
}

const shorten = (text: string, length = 60) =>
    text.length > length ? `${text.slice(0, length - 1)}…` : text;

/**
 * The document's outline: folders holding what is in them, and every
 * definition, style, macro, table, import, image and note, with `config` and
 * the ticker. A plain equation is left out; it has no name to list it by.
 */
export function getDocumentSymbols(input: DocumentInput): DocumentSymbol[] {
    const tree = toTree(input);
    const range = (node: { span: ast.Span }) => spanToRange(tree, node.span);
    const symbol = (
        name: string,
        kind: DocumentSymbolKind,
        node: { span: ast.Span },
        selection: { span: ast.Span } = node,
        extra: Partial<DocumentSymbol> = {},
    ): DocumentSymbol => ({
        name,
        kind,
        range: range(node),
        selectionRange: range(selection),
        ...extra,
    });

    const entries = (properties: readonly ast.Property[]) =>
        properties.map(property =>
            symbol(property.key.name, 'property', property, property.key, {
                detail:
                    property.value?.kind === 'Range' || !property.value
                        ? undefined
                        : shorten(printExpression(property.value)),
            }),
        );

    const statements = (list: readonly ast.Statement[]): DocumentSymbol[] =>
        list.flatMap((statement): DocumentSymbol[] => {
            switch (statement.kind) {
                case 'FolderStatement':
                    return [
                        symbol(
                            statement.title?.value ?? '(untitled folder)',
                            'folder',
                            statement,
                            statement.title ?? statement,
                            {
                                children: statements(statement.body),
                            },
                        ),
                    ];
                case 'TableStatement':
                    return [
                        symbol('table', 'table', statement, statement, {
                            children: statement.columns.flatMap(column =>
                                column.header.kind === 'Identifier' && column.values
                                    ? [
                                          symbol(
                                              column.header.name,
                                              'variable',
                                              column,
                                              column.header,
                                          ),
                                      ]
                                    : [],
                            ),
                        }),
                    ];
                case 'ConfigStatement':
                    return [
                        symbol('config', 'config', statement, statement, {
                            children: entries(statement.entries),
                        }),
                    ];
                case 'StyleStatement':
                    return [
                        symbol(statement.name.name, 'style', statement, statement.name, {
                            children: entries(statement.entries),
                        }),
                    ];
                case 'MacroStatement':
                    return [
                        symbol(statement.name.name, 'macro', statement, statement.name, {
                            detail: shorten(
                                `${statement.parameters ? `(${statement.parameters.map(p => p.name).join(', ')}) ` : ''}= ${printExpression(statement.body)}`,
                            ),
                        }),
                    ];
                case 'ImportStatement':
                    return [
                        symbol(statement.path.value, 'import', statement, statement.path, {
                            detail: statement.alias?.value,
                        }),
                    ];
                case 'ImageStatement':
                    return [
                        symbol(
                            shorten(statement.source.value, 40),
                            'image',
                            statement,
                            statement.source,
                        ),
                    ];
                case 'TickerStatement':
                    return [
                        symbol('ticker', 'ticker', statement, statement, {
                            detail: shorten(printExpression(statement.handler)),
                        }),
                    ];
                case 'NoteStatement':
                    return [
                        symbol(shorten(statement.text.value), 'note', statement, statement.text),
                    ];
                case 'ExpressionStatement': {
                    const shape = definitionShape(statement.expression);
                    if (!shape) return [];
                    return [
                        symbol(
                            shape.name.name,
                            shape.parameters ? 'function' : 'variable',
                            statement,
                            shape.name,
                            {
                                detail: shorten(
                                    `${shape.parameters ? `(${shape.parameters.map(p => p.name).join(', ')}) ` : ''}= ${printExpression(shape.body)}`,
                                ),
                            },
                        ),
                    ];
                }
                case 'ErrorStatement':
                    return [];
            }
        });

    return statements(tree.file.statements);
}

// ─────────────────────────────────────────────────────────────────────────────
// Folding
// ─────────────────────────────────────────────────────────────────────────────

export interface FoldingRange {
    /** The first line, which stays visible. */
    startLine: number;
    /** The last line folded away. */
    endLine: number;
    kind?: 'comment' | 'region';
}

/**
 * What may be folded: every statement or `@{ … }` block spread over lines, and
 * every run of comment lines. A bracket's closing line stays visible, so a
 * folded block reads `folder "A" { … }`.
 */
export function getFoldingRanges(input: DocumentInput): FoldingRange[] {
    const tree = toTree(input);
    const lines = linesOf(tree);
    const ranges: FoldingRange[] = [];

    const fold = (span: ast.Span) => {
        const startLine = lines.positionAt(span.start).line;
        const end = lines.positionAt(span.end);
        const closer = tree.source[span.end - 1];
        const closes = closer === '}' || closer === ']' || closer === ')';
        // Keep a closing bracket's line visible only when it is on a line of its own.
        const ownLine =
            closes && tree.source.slice(lines.lineStarts[end.line], span.end - 1).trim() === '';
        const endLine = ownLine ? end.line - 1 : end.line;
        if (endLine > startLine) ranges.push({ startLine, endLine });
    };

    const metadata = (node: ast.Metadata | null) => {
        if (node?.block) fold(node.span);
    };

    const visit = (statements: readonly ast.Statement[]) => {
        for (const statement of statements) {
            fold(statement.span);
            switch (statement.kind) {
                case 'FolderStatement':
                    visit(statement.body);
                    break;
                case 'TableStatement':
                    for (const column of statement.columns) metadata(column.metadata);
                    break;
                case 'ExpressionStatement':
                case 'ImageStatement':
                case 'ImportStatement':
                case 'NoteStatement':
                case 'TickerStatement':
                    metadata(statement.metadata);
                    break;
            }
        }
    };
    visit(tree.file.statements);

    // Runs of comment lines: a file header, a paragraph of explanation.
    let runStart = -1;
    let runEnd = -1;
    const endRun = () => {
        if (runEnd > runStart && runStart >= 0)
            ranges.push({ startLine: runStart, endLine: runEnd, kind: 'comment' });
        runStart = runEnd = -1;
    };
    for (let line = 0; line < lines.lineCount; line++) {
        const start = lines.lineStarts[line];
        const end = line + 1 < lines.lineCount ? lines.lineStarts[line + 1] : tree.source.length;
        if (tree.source.slice(start, end).trimStart().startsWith('//')) {
            if (runStart < 0) runStart = line;
            runEnd = line;
        } else {
            endRun();
        }
    }
    endRun();

    return ranges.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
}
