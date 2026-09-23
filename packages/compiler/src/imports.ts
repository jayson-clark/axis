// ═════════════════════════════════════════════════════════════════════════════
// Imports - resolving one file's `import "…"` statements to source
// ═════════════════════════════════════════════════════════════════════════════
//
// `import "./curves.axis"` drops the whole of another file into this one. The
// compiler does the dropping in, but it never touches a filesystem: it asks for
// a specifier's source through a {@link ResolveImport} callback and is handed
// text back. That keeps compilation synchronous and pure, which is what lets
// the same compiler run in an extension host, in a browser playground, and in
// a test with three strings in a Map.
//
// The cost is that a host has to have every reachable file in hand before it
// compiles. {@link loadImports} is that step: it walks the import graph ahead
// of time, asynchronously, over whatever notion of "a file" the host has.

import { parse, type Statement } from '@axis-dsl/syntax';
import { forEachStatement } from './walk';

/** A file an import resolved to: where it lives, and what it says. */
export interface ResolvedImport {
    /**
     * The file's identity, however the host names one - an absolute path, a
     * URI, a key in a Map. It is compared for equality to detect import cycles
     * and reported back as a dependency, so two specifiers naming the same file
     * must resolve to the same string.
     */
    path: string;
    source: string;
}

/**
 * Resolve `specifier`, as written in the file at `from`, to its source.
 *
 * Returning undefined means the file could not be found, which the compiler
 * reports as an error against the import statement.
 */
export type ResolveImport = (specifier: string, from: string) => ResolvedImport | undefined;

/**
 * Every specifier `source` imports, in the order it imports them.
 *
 * Read off the syntax tree, so an import is found wherever the parser finds
 * one - inside a folder, on a line shared with another statement - and a note
 * that happens to say `import "x"`, or a variable called `important`, is not
 * one.
 */
export function findImports(source: string): string[] {
    return findStatements(source, 'ImportStatement').map(statement => statement.path.value);
}

/** Every statement of one kind in `source`, folders opened, in source order. */
export function findStatements<K extends Statement['kind']>(
    source: string,
    kind: K,
): Extract<Statement, { kind: K }>[] {
    const found: Extract<Statement, { kind: K }>[] = [];
    forEachStatement(parse(source).file.statements, statement => {
        if (statement.kind === kind) {
            found.push(statement as Extract<Statement, { kind: K }>);
        }
    });
    return found;
}

/** How {@link loadImports} names and reads the host's files. */
export interface ImportHost {
    /**
     * Turn `specifier`, as written in the file at `from`, into the path the
     * file is known by. Where relative paths, extensions and roots are decided
     * - the host owns all three, since only it knows what its paths mean.
     */
    resolve(specifier: string, from: string): string;
    /** Read a file named by {@link resolve}. Rejecting means it is not there. */
    read(path: string): Promise<string>;
}

/**
 * Read every file reachable from `entry` by import, transitively.
 *
 * The result is keyed by resolved path and is what {@link createImportResolver}
 * turns into the synchronous callback the compiler wants.
 *
 * Nothing here is an error. A cycle is not followed - the same file is simply
 * not read twice - and a file that cannot be read is left out, so that the
 * compiler reports both against the statement responsible, where a user can
 * see which import to fix, rather than failing the whole load with no place
 * to point at.
 */
export async function loadImports(
    entry: ResolvedImport,
    host: ImportHost,
): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const missing = new Set<string>();

    // The entry is queued but not stored: it is only added to `files` if some
    // other file imports it back, which is the cycle the compiler reports.
    const queue: ResolvedImport[] = [entry];
    const queued = new Set([entry.path]);

    while (queue.length > 0) {
        const current = queue.shift()!;

        for (const specifier of findImports(current.source)) {
            const path = host.resolve(specifier, current.path);
            if (missing.has(path)) {
                continue;
            }

            if (!files.has(path)) {
                if (path === entry.path) {
                    files.set(path, entry.source);
                } else {
                    try {
                        files.set(path, await host.read(path));
                    } catch {
                        missing.add(path);
                        continue;
                    }
                }
            }

            if (!queued.has(path)) {
                queued.add(path);
                queue.push({ path, source: files.get(path)! });
            }
        }
    }

    return files;
}

/** A {@link ResolveImport} that reads from an already-loaded set of files. */
export function createImportResolver(
    files: ReadonlyMap<string, string>,
    resolve: ImportHost['resolve'],
): ResolveImport {
    return (specifier, from) => {
        const path = resolve(specifier, from);
        const source = files.get(path);
        return source === undefined ? undefined : { path, source };
    };
}
