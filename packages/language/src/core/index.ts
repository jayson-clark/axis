// ═════════════════════════════════════════════════════════════════════════════
// The platform-neutral language services
// ═════════════════════════════════════════════════════════════════════════════
//
// Listed one by one rather than re-exported wholesale, so this file is the
// package's public surface: `scan.ts` is the primitive the modules below share
// and stays internal to them.

export {
    AXIS_FILE_EXTENSION,
    AXIS_LANGUAGE_CONFIGURATION,
    AXIS_LANGUAGE_ID,
} from './language-config';

export type {
    AxisCompletionItem,
    AxisCompletionKind,
    AxisFormattingOptions,
    AxisPosition,
} from './types';

export { getAxisCompletions } from './completions';

export {
    findImportStatements,
    importTitle,
    IMPORT_KEYWORD,
    parseImportStatement,
    withAxisExtension,
} from './imports';
export type { ImportStatement, LocatedImport } from './imports';

export { createDebouncer } from './debounce';
export type { Debouncer } from './debounce';

export { missingImportDiagnostic, validateAxis } from './diagnostics';
export type { AxisDiagnostic, AxisDiagnosticCode, AxisDiagnosticSeverity } from './diagnostics';

export { formatAxisCode, formatAxisCodeWithIndent, indentLevelOf } from './formatter';

export { splitTopLevel, splitTopLevelParts, splitTrailingMetadata } from './metadata';
export type { SplitLine, TopLevelPart } from './metadata';

// The layout services the compiler leans on to read a script the same way an
// editor does, whether a block was written inline or spread over lines.
export { bracketDelta, joinContinuedLines, leadingClosers } from './brackets';
export {
    BLOCK_KEYWORDS,
    expandBlockEntries,
    insertMissingSeparators,
    missingSeparators,
    scanBlockLine,
} from './blocks';
export type { BlockFrame, BlockKind, BlockSegment, BlockSegmentKind } from './blocks';
