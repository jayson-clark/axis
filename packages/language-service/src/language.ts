// ═════════════════════════════════════════════════════════════════════════════
// The language's identity and editing behaviour
// ═════════════════════════════════════════════════════════════════════════════
//
// What an editor needs to know before it can offer anything: the id and
// extension it registers the language under, and how brackets, comments and
// words behave. Plain data, so every host reads the one copy.

export { AXIS_FILE_EXTENSION } from '@axis-dsl/syntax';

/** The language id every editor registers Axis under. */
export const AXIS_LANGUAGE_ID = 'axis';

/**
 * A word, as the lexer reads an identifier (spec §2.2): `x`, `amp`, `x_1`,
 * `LOOP_FORWARD_REVERSE`. Editors use it for double-click selection and for
 * what "the word at the cursor" is.
 */
export const AXIS_WORD_PATTERN = /[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*/;

/** Brackets, comments and auto-closing, in the shape VSCode's and Monaco's configurations share. */
export const AXIS_LANGUAGE_CONFIGURATION = {
    comments: { lineComment: '//' },
    brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
    ] as [string, string][],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
    ],
};
