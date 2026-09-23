// ═════════════════════════════════════════════════════════════════════════════
// The examples' directory, bundled into the page
// ═════════════════════════════════════════════════════════════════════════════
//
// Every example on the site is written as though it sat in `examples/graphs/`
// - which is where the tests compile it - so it may import `./lib/waves` or
// draw `./images/wave.png`. The playground has no disk to read them from, so
// Vite bundles the library and the pictures in, and these resolvers answer
// from that: the source in the playground is `examples/graphs/playground.axis`.

import type { CompileOptions } from '@axis-dsl/compiler';
import { imageMediaType, withAxisExtension } from '@axis-dsl/syntax';

const ROOT = '/examples/graphs/';

/** `../../examples/graphs/lib/waves.axis` as `/examples/graphs/lib/waves.axis`. */
const key = (path: string) => ROOT + path.slice(path.indexOf('/examples/graphs/') + ROOT.length);

const sources = Object.fromEntries(
    Object.entries(
        import.meta.glob<string>('../../../../examples/graphs/lib/**/*.axis', {
            query: '?raw',
            import: 'default',
            eager: true,
        }),
    ).map(([path, source]) => [key(path), source]),
);

const pictures = Object.fromEntries(
    Object.entries(
        import.meta.glob<string>('../../../../examples/graphs/images/**/*', {
            query: '?inline',
            import: 'default',
            eager: true,
        }),
    ).map(([path, dataUri]) => [key(path), dataUri]),
);

/** `./lib/waves` from `/examples/graphs/playground.axis`, as a path in the bundle. */
function resolve(specifier: string, from: string): string {
    const segments = specifier.startsWith('/')
        ? [...ROOT.split('/'), ...specifier.slice(1).split('/')]
        : [...from.split('/').slice(0, -1), ...specifier.split('/')];
    const path: string[] = [];
    for (const segment of segments) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') path.pop();
        else path.push(segment);
    }
    return `/${path.join('/')}`;
}

/** What to compile the playground's source with. One object, so it never recompiles for nothing. */
export const PLAYGROUND_OPTIONS: CompileOptions = {
    path: `${ROOT}playground.axis`,
    resolveImport: (specifier, from) => {
        const path = resolve(withAxisExtension(specifier), from);
        const source = sources[path];
        return source === undefined ? undefined : { path, source };
    },
    resolveImage: (url, from) => {
        const path = resolve(url, from);
        const dataUri = pictures[path];
        return dataUri === undefined || imageMediaType(path) === undefined
            ? undefined
            : { path, dataUri };
    },
};
