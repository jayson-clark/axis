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
    AXIS_IMAGE_EXTENSIONS,
    findImageStatements,
    IMAGE_KEYWORD,
    imageMediaType,
    isImageUrl,
    parseImageStatement,
} from './images';
export type { ImageStatement, LocatedImage } from './images';

export {
    findImportStatements,
    importTitle,
    IMPORT_KEYWORD,
    parseImportStatement,
    withAxisExtension,
} from './imports';
export type { ImportStatement, LocatedImport } from './imports';

export { parseTickerStatement, TICKER_KEYWORD } from './ticker';
export type { TickerStatement } from './ticker';

export {
    defineMacro,
    expandMacros,
    findMacroDefinitions,
    MACRO_KEYWORD,
    MacroError,
    parseMacroDefinition,
} from './macros';
export type { MacroDefinition, MacroTable } from './macros';

export { createDebouncer } from './debounce';
export type { Debouncer } from './debounce';

export { missingImageDiagnostic, missingImportDiagnostic, validateAxis } from './diagnostics';
export type { AxisDiagnostic, AxisDiagnosticCode, AxisDiagnosticSeverity } from './diagnostics';

export { formatAxisCode, formatAxisCodeWithIndent, indentLevelOf } from './formatter';

export { splitTopLevel, splitTopLevelParts, splitTrailingMetadata } from './metadata';
export { escapeString, unescapeString } from './strings';
export type { SplitLine, TopLevelPart } from './metadata';

// The layout services the compiler leans on to read a script the same way an
// editor does, whether a block was written inline or spread over lines.
export { bracketDelta, joinContinuedLines, leadingClosers } from './brackets';
export {
    BLOCK_KEYWORDS,
    expandBlockEntries,
    foldMetadataBlocks,
    insertMissingSeparators,
    metadataBlockLines,
    missingSeparators,
    removeRedundantSeparators,
    scanBlockLine,
} from './blocks';
export type { BlockFrame, BlockKind, BlockSegment, BlockSegmentKind } from './blocks';
