// ═════════════════════════════════════════════════════════════════════════════
// Imports, as the v1 compiler finds them
// ═════════════════════════════════════════════════════════════════════════════
//
// The regex walk the v1 compiler hoists macros with. v2 finds imports on the
// syntax tree (`../imports.ts`); this stays with `./compile.ts` until the
// decompiler and write-back that depend on it are replaced.

import {
    expandBlockEntries,
    foldMetadataBlocks,
    joinContinuedLines,
    parseImportStatement,
    splitTrailingMetadata,
} from '@axis-dsl/language';

/** Every specifier `source` imports, in the order it imports them. */
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
