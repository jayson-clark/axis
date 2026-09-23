// ═════════════════════════════════════════════════════════════════════════════
// Tokens
// ═════════════════════════════════════════════════════════════════════════════
//
// The lexer's output, trivia included: concatenating every token's `text`
// gives back the source exactly. That is what lets the tree beside it stay
// abstract - comments and spacing are never lost, they are just here.

import type { Span } from './ast';

export type TokenKind =
    | 'number'
    | 'identifier'
    | 'string'
    | 'color'
    | 'keyword'
    | 'punctuation'
    | 'newline'
    | 'whitespace'
    | 'comment'
    | 'error'
    | 'eof';

/** The words the lexer never reads as identifiers (spec §2.2). */
export const KEYWORDS = [
    'folder',
    'table',
    'config',
    'import',
    'image',
    'ticker',
    'style',
    'macro',
    'as',
    'for',
    'with',
    'step',
    'soft',
] as const;

export type Keyword = (typeof KEYWORDS)[number];

export interface Token {
    kind: TokenKind;
    /** Exactly the source characters the token covers. */
    text: string;
    span: Span;
}

/** Whether a token carries no meaning for the parser. Newlines do. */
export const isTrivia = (token: Token): boolean =>
    token.kind === 'whitespace' || token.kind === 'comment';
