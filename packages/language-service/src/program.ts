// ═════════════════════════════════════════════════════════════════════════════
// The compiler's view - diagnostics, and the names other files define
// ═════════════════════════════════════════════════════════════════════════════
//
// Two things only the compiler can say, because both need the whole import
// graph rather than one file's tree: everything a compile would report, and
// what the files an import brings in define. Macros, styles and every
// definition are global to a compilation (spec §4.5, §6), so a file uses
// names it never defines - `use: faint`, `envelope(x)` - and an editor that
// only read the file in front of it would call them unknown.
//
// Both come through the compiler's own passes (`compileAxis`, `loadProgram`,
// `collectSymbols`), with the host's resolvers, so the editor reports and
// resolves exactly what a compile would. A host with no file system passes no
// `resolveImport`, and an import is then the error it would be in a compile.

import {
    collectSymbols,
    compileAxis,
    definitionOf,
    loadProgram,
    type ResolveImage,
    type ResolveImport,
    type SourceFile,
} from '@axis-dsl/compiler';
import type { Diagnostic, Identifier, Statement, SyntaxTree } from '@axis-dsl/syntax';
import { allStatements } from './symbols';

/** How to find what a file imports: the compiler's resolvers, and where the file lives. */
export interface ProgramOptions {
    /** The document's path, as the resolvers name files; relative imports resolve against it. */
    path?: string;
    /** Reads an imported file. Without it, every import is unresolved - as in a compile. */
    resolveImport?: ResolveImport;
    /** Reads an image's picture. Without it, an image that names a file is unresolved. */
    resolveImage?: ResolveImage;
}

/**
 * The semantic checker: everything a compile reports about the document
 * beyond its syntax. The compiler's diagnostics for an imported file carry
 * that file's `path`, and are left to the host to show against it.
 */
export function compilerDiagnostics(tree: SyntaxTree, options: ProgramOptions = {}): Diagnostic[] {
    return compileAxis(tree.source, options).diagnostics.filter(
        diagnostic => diagnostic.path === undefined || diagnostic.path === options.path,
    );
}

/** A name one of the document's imports defines. */
export interface ImportedSymbol {
    name: string;
    kind: 'variable' | 'function' | 'macro' | 'style';
    /** The name as written where it is defined. */
    identifier: Identifier;
    statement: Statement;
    /** A function's or macro's parameters. */
    parameters?: string[];
    /** The file it is defined in, as the resolver named it. */
    file: SourceFile;
}

const cache = new WeakMap<SyntaxTree, Map<ResolveImport, ImportedSymbol[]>>();

/**
 * Every name the files the document imports define - directly or through
 * imports of their own - the first definition of each. Empty without a
 * resolver. Cached per tree and resolver.
 */
export function importedSymbols(tree: SyntaxTree, options: ProgramOptions = {}): ImportedSymbol[] {
    const { resolveImport } = options;
    if (!resolveImport) return [];
    let byResolver = cache.get(tree);
    if (!byResolver) cache.set(tree, (byResolver = new Map()));
    const cached = byResolver.get(resolveImport);
    if (cached) return cached;

    const program = loadProgram(tree.source, { path: options.path, resolveImport });
    // The compiler's collection decides which macros stand - one named after
    // a builtin or a definition is dropped - so the editor offers only those.
    const { symbols } = collectSymbols(program);
    const found: ImportedSymbol[] = [];
    const seen = new Set<string>();
    const add = (symbol: ImportedSymbol) => {
        const key = `${symbol.kind === 'style' ? 'style' : 'value'}:${symbol.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push(symbol);
    };

    for (const file of program.files) {
        if (file.entry) continue;
        for (const statement of allStatements(file.tree.file.statements)) {
            switch (statement.kind) {
                case 'MacroStatement':
                    if (symbols.macros.get(statement.name.name)?.statement !== statement) break;
                    add({
                        name: statement.name.name,
                        kind: 'macro',
                        identifier: statement.name,
                        statement,
                        parameters: statement.parameters?.map(parameter => parameter.name),
                        file,
                    });
                    break;
                case 'StyleStatement':
                    if (symbols.styles.get(statement.name.name)?.statement !== statement) break;
                    add({
                        name: statement.name.name,
                        kind: 'style',
                        identifier: statement.name,
                        statement,
                        file,
                    });
                    break;
                case 'ExpressionStatement': {
                    const definition = definitionOf(statement.expression);
                    if (!definition) break;
                    add({
                        name: definition.name.name,
                        kind: definition.kind,
                        identifier: definition.name,
                        statement,
                        parameters:
                            definition.kind === 'function'
                                ? definition.parameters.map(parameter => parameter.name)
                                : undefined,
                        file,
                    });
                    break;
                }
                case 'TableStatement':
                    for (const column of statement.columns) {
                        if (column.values !== null && column.header.kind === 'Identifier') {
                            add({
                                name: column.header.name,
                                kind: 'variable',
                                identifier: column.header,
                                statement,
                                file,
                            });
                        }
                    }
                    break;
            }
        }
    }

    byResolver.set(resolveImport, found);
    return found;
}

/** The imported definition of a name, in the namespace a use of it looks in. */
export function importedSymbol(
    tree: SyntaxTree,
    options: ProgramOptions,
    name: string,
    namespace: 'value' | 'style',
): ImportedSymbol | undefined {
    return importedSymbols(tree, options).find(
        symbol => symbol.name === name && (symbol.kind === 'style') === (namespace === 'style'),
    );
}
