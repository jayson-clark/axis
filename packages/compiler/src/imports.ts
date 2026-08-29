// ═════════════════════════════════════════════════════════════════════════════
// Imports - resolving one script's `import "…"` statements to source
// ═════════════════════════════════════════════════════════════════════════════
//
// `import "./curves.axis"` drops the whole of another script into this one. The
// compiler does the dropping in, but it never touches a filesystem: it asks for
// a specifier's source through a {@link ResolveImport} callback and is handed
// text back. That keeps compilation synchronous and pure, which is what lets
// the same compiler run in an extension host, in a browser playground, and in
// a test with three strings in a Map.
//
// The cost is that a host has to have every reachable file in hand before it
// compiles. {@link loadImports} is that step: it walks the import graph ahead
// of time, asynchronously, over whatever notion of "a file" the host has.

import {
    expandBlockEntries,
    foldMetadataBlocks,
    joinContinuedLines,
    parseImportStatement,
    splitTrailingMetadata,
} from '@axis-dsl/language';

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
 * The source is flattened first, so an import written inline inside a folder is
 * found just as one on a line of its own is.
 */
export function findImports(source: string): string[] {
    const specifiers: string[] = [];

    for (const line of expandBlockEntries(joinContinuedLines(foldMetadataBlocks(source)))) {
        const statement = parseImportStatement(splitTrailingMetadata(line.trim()).code);
        if (statement) {
            specifiers.push(statement.specifier);
        }
    }

    return specifiers;
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
 * A cycle is not an error here - the same file is simply not read twice - so
 * that the compiler can report it against the statement that closes the loop,
 * where a user can see which import to remove.
 */
export async function loadImports(
    entry: ResolvedImport,
    host: ImportHost,
): Promise<Map<string, string>> {
    const files = new Map<string, string>();

    /** Read one file, naming the import that asked for it if it is not there. */
    const read = async (specifier: string, path: string, from: string): Promise<string> => {
        try {
            return await host.read(path);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`Cannot read "${specifier}", imported by ${from}: ${reason}`);
        }
    };

    // The entry is queued but not stored: it is only added to `files` if some
    // other file imports it back, which is the cycle the compiler reports.
    const queue: ResolvedImport[] = [entry];
    const queued = new Set([entry.path]);

    while (queue.length > 0) {
        const current = queue.shift()!;

        for (const specifier of findImports(current.source)) {
            const path = host.resolve(specifier, current.path);

            if (!files.has(path)) {
                files.set(
                    path,
                    path === entry.path ? entry.source : await read(specifier, path, current.path),
                );
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
