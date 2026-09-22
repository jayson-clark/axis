// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/syntax - the Axis language, read
// ═════════════════════════════════════════════════════════════════════════════
//
// Source in, a syntax tree and its diagnostics out. `docs/spec.md` is the
// language; `ast.ts` is its shape.

export type * from './ast';
export type { Token, TokenKind, Keyword } from './tokens';
export { KEYWORDS, isTrivia } from './tokens';
export * from './manifest';

// The lexer and parser land in #14 and #15.
