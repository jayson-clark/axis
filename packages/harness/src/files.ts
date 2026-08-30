// ═════════════════════════════════════════════════════════════════════════════
// Reading a .axis file off disk, imports and all
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler never touches a filesystem — it asks a host for an import's
// source. This is that host for Node, resolving specifiers the same way the
// VSCode extension does, so a script that previews in the editor compiles here.

import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { ImportHost, ResolveImport, createImportResolver, loadImports } from '@axis-dsl/compiler';
import { withAxisExtension } from '@axis-dsl/language';

/**
 * Reads imports relative to the importing file. A leading `/` is relative to
 * `root` instead, which is the workspace folder in the editor and the script's
 * own directory here.
 */
export function nodeImportHost(root: string = process.cwd()): ImportHost {
    return {
        resolve: (specifier, from) => {
            const target = withAxisExtension(specifier);
            return target.startsWith('/')
                ? resolvePath(root, target.slice(1))
                : resolvePath(dirname(from), target);
        },
        read: path => readFile(path, 'utf8'),
    };
}

/** A script and the resolver its imports need, ready to hand to the compiler. */
export interface LoadedScript {
    path: string;
    source: string;
    resolveImport: ResolveImport;
}

/** Read the script at `path` and every file it imports, transitively. */
export async function readAxisFile(path: string, root?: string): Promise<LoadedScript> {
    const absolute = resolvePath(path);
    const host = nodeImportHost(root ?? dirname(absolute));
    const source = await readFile(absolute, 'utf8');
    const files = await loadImports({ path: absolute, source }, host);
    return { path: absolute, source, resolveImport: createImportResolver(files, host.resolve) };
}
