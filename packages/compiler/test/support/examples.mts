// ═════════════════════════════════════════════════════════════════════════════
// The examples' directory, as a place to compile from
// ═════════════════════════════════════════════════════════════════════════════
//
// The files in `examples/graphs/` import `./lib/…` and draw `./images/…`,
// and so do the manifest's examples and the docs', which are read as though
// they sat beside them. These resolve both off disk, synchronously, the way a
// host would after walking the import graph.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageMediaType } from '@axis-dsl/syntax';
import type { CompileOptions } from '../../dist/index.js';

export const EXAMPLES_DIRECTORY = fileURLToPath(
    new URL('../../../../examples/graphs/', import.meta.url),
);

export const resolveImport = (specifier: string, from: string) => {
    const target = specifier.endsWith('.axis') ? specifier : `${specifier}.axis`;
    const path = target.startsWith('/')
        ? resolve(EXAMPLES_DIRECTORY, target.slice(1))
        : resolve(dirname(from), target);
    return { path, source: readFileSync(path, 'utf8') };
};

export const resolveImage = (url: string, from: string) => {
    const path = url.startsWith('/')
        ? resolve(EXAMPLES_DIRECTORY, url.slice(1))
        : resolve(dirname(from), url);
    const data = readFileSync(path).toString('base64');
    return { path, dataUri: `data:${imageMediaType(path)};base64,${data}` };
};

/** What to compile a file with, as the file at `path` - by default, one beside the examples. */
export function exampleOptions(path = resolve(EXAMPLES_DIRECTORY, 'example.axis')): CompileOptions {
    return { path, resolveImport, resolveImage };
}
