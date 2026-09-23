// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/language-service - Axis editor services over the syntax tree
// ═════════════════════════════════════════════════════════════════════════════
//
// Diagnostics, completions, hover, formatting, semantic tokens, links and
// navigation, each a plain function of a `SyntaxTree` (or the source to parse
// into one) and a position. Positions are zero-based lines and UTF-16
// characters, as `lineIndex` in `@axis-dsl/syntax` counts them.
//
// Nothing here touches an editor or the DOM: `./monaco` adapts it to Monaco,
// and the language server (#26) adapts it to LSP. Diagnostics, and the names
// a file's imports define, come from the compiler's own passes, given the
// host's `resolveImport` and `resolveImage` (`ProgramOptions`).

export {
    toTree,
    spanToRange,
    rangeToSpan,
    type DocumentInput,
    type Position,
    type Range,
    type TextEdit,
} from './document';
export {
    AXIS_FILE_EXTENSION,
    AXIS_LANGUAGE_CONFIGURATION,
    AXIS_LANGUAGE_ID,
    AXIS_WORD_PATTERN,
} from './language';
export {
    getDiagnostics,
    missingImageDiagnostic,
    missingImportDiagnostic,
    toDiagnostic,
    type Diagnostic,
    type DiagnosticOptions,
    type DiagnosticSeverity,
    type SemanticChecker,
} from './diagnostics';
export {
    getCompletions,
    type CompletionItem,
    type CompletionKind,
    type CompletionOptions,
} from './completions';
// What a path names is the language's, so it lives in `@axis-dsl/syntax`; it is
// passed on here for a host that reaches for everything through this package.
export {
    AXIS_IMAGE_EXTENSIONS,
    imageMediaType,
    importTitle,
    isImageUrl,
    withAxisExtension,
} from '@axis-dsl/syntax';
export {
    getPathCompletions,
    getPathContext,
    type DirectoryEntry,
    type PathContext,
    type PathKind,
} from './paths';
export { getHover, type Hover } from './hover';
export { formatDocument, formatRange, formatSource, type FormattingOptions } from './format';
export {
    getSemanticTokenList,
    getSemanticTokens,
    SEMANTIC_TOKEN_LEGEND,
    SEMANTIC_TOKEN_MODIFIERS,
    SEMANTIC_TOKEN_TYPES,
    type SemanticToken,
    type SemanticTokenModifier,
    type SemanticTokenOptions,
    type SemanticTokens,
    type SemanticTokenType,
} from './semantic-tokens';
export { getDocumentLinks, type DocumentLink, type DocumentLinkKind } from './links';
export {
    getDefinition,
    getDocumentHighlights,
    getDocumentSymbols,
    getFoldingRanges,
    getReferences,
    type DefinitionOptions,
    type DocumentHighlight,
    type DocumentSymbol,
    type DocumentSymbolKind,
    type FoldingRange,
    type Location,
    type ReferenceOptions,
} from './navigation';
export { cursorContext, type CursorContext, type CursorInfo, type StatementOwner } from './context';
export {
    analyze,
    type Analysis,
    type Occurrence,
    type OccurrenceRole,
    type SymbolDefinition,
    type SymbolKind,
    type SymbolNamespace,
} from './symbols';
export { KEYWORD_INFO, STATEMENT_KEYWORDS, type KeywordInfo } from './keywords';
export {
    compilerDiagnostics,
    importedSymbols,
    type ImportedSymbol,
    type ProgramOptions,
} from './program';
export { snippetSignature } from './describe';
