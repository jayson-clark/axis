// Resolvers for the suites that follow imports: one over a Map of sources, and
// one over the example graphs on disk, both as the compiler takes them.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Resolver = (specifier: string, from: string) => { path: string; source: string } | undefined;

/** A path as written in the file at `from`, made absolute. */
const beside = (path: string, from: string) =>
    new URL(path, `file://${from.slice(0, from.lastIndexOf('/') + 1) || '/'}`).pathname;

/** `./a` from `/dir/main.axis` is `/dir/a.axis`, as spec §7 has it. */
const join = (specifier: string, from: string) => {
    const path = beside(specifier, from);
    return path.endsWith('.axis') ? path : `${path}.axis`;
};

/** A resolver over sources held in memory, keyed by absolute path. */
export function resolveFrom(files: Record<string, string>): Resolver {
    return (specifier, from) => {
        const path = join(specifier, from || '/main.axis');
        return path in files ? { path, source: files[path] } : undefined;
    };
}

const EXAMPLES = fileURLToPath(new URL('../../../examples/', import.meta.url));

/** The options that compile an example graph the way the CLI would: from its file. */
export function resolveExample(name: string) {
    return {
        path: `${EXAMPLES}${name}`,
        resolveImport: ((specifier, from) => {
            const path = join(specifier, from);
            try {
                return { path, source: readFileSync(path, 'utf8') };
            } catch {
                return undefined;
            }
        }) as Resolver,
        // The picture's bytes are nothing to the editor; that it resolves is all.
        resolveImage: (url: string, from: string) => ({
            path: beside(url, from),
            dataUri: 'data:image/png;base64,AA==',
        }),
    };
}
