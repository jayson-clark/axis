// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/syntax - the Axis language, read
// ═════════════════════════════════════════════════════════════════════════════
//
// Source in, a syntax tree and its diagnostics out. `docs/spec.md` is the
// language; `ast.ts` is its shape.

export type * from './ast';
export type { Token, TokenKind, Keyword } from './tokens';
export { KEYWORDS, isTrivia } from './tokens';
export { lex, unescapeString, type LexResult } from './lexer';
export { parse, parseExpression, type SyntaxTree } from './parser';
export { lineIndex, type LineIndex, type Position } from './lines';
export { debugTree } from './debug';
export { SYNTAX_DIAGNOSTICS, type DiagnosticInfo, type SyntaxDiagnosticCode } from './diagnostics';
export * from './manifest';
export {
    AXIS_FILE_EXTENSION,
    AXIS_IMAGE_EXTENSIONS,
    imageMediaType,
    importTitle,
    isImageUrl,
    withAxisExtension,
} from './files';
export {
    format,
    printExpression,
    printStatement,
    sameTree,
    stripParens,
    type PrintOptions,
    type StatementPrintOptions,
} from './print';
