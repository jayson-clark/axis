// ═════════════════════════════════════════════════════════════════════════════
// The program - every file a compilation reads, parsed once
// ═════════════════════════════════════════════════════════════════════════════
//
// A script is compiled together with everything it imports: macros and styles
// are hoisted across the whole import graph, a name defined in one file is a
// function in another, and the entry's config wins over an imported one. So the
// first thing a compilation does is read the whole graph, and every pass after
// it - the checker, the expander, the lowering - works over the same parsed
// files rather than parsing again, or each having its own idea of which files
// are in.
//
// The walk is depth-first in statement order, which is the order the files'
// statements reach the graph in, and it decides once what each `import`
// statement stands for. A file imported twice is included the first time and
// is nothing the second, since the second copy would define every one of its
// names again and Desmos rejects a name defined twice. An import that closes a
// cycle is an error against the statement that closes it, where somebody can
// see which one to remove.

import {
    type Diagnostic,
    type ImportStatement,
    lineIndex,
    type LineIndex,
    parse,
    type SyntaxTree,
} from '@axis-dsl/syntax';
import type { ResolveImport } from './imports';
import { forEachStatement } from './walk';

/** One file of a compilation: its text, its tree, and where its lines start. */
export interface SourceFile {
    /** The file's identity as the host named it; `''` for a script with no path. */
    path: string;
    source: string;
    tree: SyntaxTree;
    lines: LineIndex;
    /** Whether this is the script being compiled rather than one it imports. */
    entry: boolean;
}

/**
 * What one `import` statement turned out to mean.
 *
 * - `file`: the first import of that file, whose statements land here
 * - `repeat`: a file an earlier import already included, which adds nothing
 * - `cycle` and `unresolved`: errors, already reported
 */
export type ImportResolution =
    | { kind: 'file'; file: SourceFile }
    | { kind: 'repeat'; file: SourceFile }
    | { kind: 'cycle' }
    | { kind: 'unresolved' };

export interface Program {
    entry: SourceFile;
    /** Every file read, the entry first and then the imports in the order they land. */
    files: SourceFile[];
    imports: Map<ImportStatement, ImportResolution>;
    /** The parser's diagnostics for every file, and what the walk found. */
    diagnostics: Diagnostic[];
}

export interface LoadProgramOptions {
    path?: string;
    resolveImport?: ResolveImport;
}

/** Parse `source` and everything it imports. Never throws. */
export function loadProgram(source: string, options: LoadProgramOptions = {}): Program {
    const diagnostics: Diagnostic[] = [];
    const imports = new Map<ImportStatement, ImportResolution>();
    const files: SourceFile[] = [];
    const byPath = new Map<string, SourceFile>();

    const read = (path: string, text: string, entry: boolean): SourceFile => {
        const tree = parse(text);
        const file: SourceFile = { path, source: text, tree, lines: lineIndex(text), entry };
        files.push(file);
        byPath.set(path, file);
        diagnostics.push(...tree.diagnostics.map(diagnostic => located(diagnostic, file)));
        return file;
    };

    const visit = (file: SourceFile, chain: string[]): void => {
        forEachStatement(file.tree.file.statements, statement => {
            if (statement.kind !== 'ImportStatement') {
                return;
            }

            const specifier = statement.path.value;
            let resolved: ReturnType<ResolveImport>;
            try {
                resolved = options.resolveImport?.(specifier, file.path);
            } catch {
                // A resolver that throws has not found the file either, and a
                // compilation that never throws cannot let it through.
                resolved = undefined;
            }

            if (!resolved) {
                imports.set(statement, { kind: 'unresolved' });
                diagnostics.push(
                    located(
                        {
                            code: 'unresolved-import',
                            severity: 'error',
                            message: options.resolveImport
                                ? `Cannot resolve import "${specifier}"${file.path ? ` from ${file.path}` : ''}.`
                                : `Cannot resolve import "${specifier}": nothing was given to read imports with.`,
                            span: statement.path.span,
                        },
                        file,
                    ),
                );
                return;
            }

            if (chain.includes(resolved.path)) {
                imports.set(statement, { kind: 'cycle' });
                const loop = [...chain.slice(chain.indexOf(resolved.path)), resolved.path];
                diagnostics.push(
                    located(
                        {
                            code: 'import-cycle',
                            severity: 'error',
                            message: `Import cycle: ${loop.join(' -> ')}.`,
                            span: statement.path.span,
                        },
                        file,
                    ),
                );
                return;
            }

            const known = byPath.get(resolved.path);
            if (known) {
                imports.set(statement, { kind: 'repeat', file: known });
                return;
            }

            const imported = read(resolved.path, resolved.source, false);
            imports.set(statement, { kind: 'file', file: imported });
            visit(imported, [...chain, resolved.path]);
        });
    };

    const path = options.path ?? '';
    const entry = read(path, source, true);
    visit(entry, [path]);

    return { entry, files, imports, diagnostics };
}

/**
 * `diagnostic`, marked with the file it belongs to when that is not the entry.
 * The entry's are left bare: they are about the script the caller handed over,
 * which needs no naming.
 */
export function located(diagnostic: Diagnostic, file: SourceFile): Diagnostic {
    return file.entry ? diagnostic : { ...diagnostic, path: file.path };
}
