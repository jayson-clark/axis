// ═════════════════════════════════════════════════════════════════════════════
// Compiling a file in a test
// ═════════════════════════════════════════════════════════════════════════════
//
// The shapes every compiler suite reaches for: the list a file lowers to, the
// one item a one-line file makes, the codes of what the compiler said about
// it, and a filesystem of strings to import from.

import type { DesmosExpression } from '@axis-dsl/desmos';
import { compileAxis, createImportResolver } from '../../dist/index.js';
import type { CompilationResult, CompileOptions } from '../../dist/index.js';

export { compileAxis };
export type { CompilationResult, CompileOptions };

/** The expression list a file lowers to. */
export function listOf(source: string, options?: CompileOptions): DesmosExpression[] {
    return compileAxis(source, options).state.expressions?.list ?? [];
}

/** The one item a one-statement file lowers to; the last, for a longer one. */
export function only<T>(source: string, options?: CompileOptions): T {
    const list = listOf(source, options);
    return list[list.length - 1] as T;
}

/** The codes of what the compiler reported, in the order it reported them. */
export function codes(source: string, options?: CompileOptions): string[] {
    return compileAxis(source, options).diagnostics.map(diagnostic => diagnostic.code);
}

/** Posix-ish resolution: relative to the importing file, `.axis` implied. */
export function resolvePath(specifier: string, from: string): string {
    const segments = [...from.split('/').slice(0, -1), ...specifier.split('/')];
    const path: string[] = [];

    for (const segment of segments) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') path.pop();
        else path.push(segment);
    }

    return `/${path.join('/')}`;
}

export const withExtension = (specifier: string) =>
    specifier.endsWith('.axis') ? specifier : `${specifier}.axis`;

export const ENTRY = '/main.axis';

/** Compile `source` as `/main.axis`, with `files` on disk beside it. */
export function compileWith(
    source: string,
    files: Record<string, string> = {},
    options: CompileOptions = {},
): CompilationResult {
    return compileAxis(source, {
        path: ENTRY,
        resolveImport: createImportResolver(new Map(Object.entries(files)), (specifier, from) =>
            resolvePath(withExtension(specifier), from),
        ),
        ...options,
    });
}
