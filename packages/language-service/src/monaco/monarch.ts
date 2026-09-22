// ═════════════════════════════════════════════════════════════════════════════
// Monarch grammar for Axis
// ═════════════════════════════════════════════════════════════════════════════
//
// The TextMate grammar in `syntaxes/` is what VSCode reads; Monaco cannot read
// TextMate without an Oniguruma WASM runtime, so this is the browser's
// equivalent. Both are deliberately shallow - they colour what can be told from
// the characters alone, and the language service's semantic tokens do the
// precise work over the syntax tree - but they agree on every token they do
// colour, and both draw their word lists from the manifest in
// `@axis-dsl/syntax`, so neither falls behind as the language grows.
//
// Monarch matches each rule against the rest of the current line, so a rule
// cannot look behind itself and `^` only ever means the start of the line.
// That shapes the inline metadata states below: an `@ …` runs to the end of
// its statement's line, and Monarch can only see the end of a line through the
// `@eos` guard, so every rule in them is written through `untilEol`.

import type * as monaco from 'monaco-editor/editor';
import {
    AXIS_CONSTANT_NAMES,
    AXIS_FUNCTION_NAMES,
    AXIS_OPERATOR_NAMES,
    KEYWORDS,
} from '@axis-dsl/syntax';

/** The Desmos palette colours a `color` may name (spec §4.3). */
export const AXIS_PALETTE_NAMES = ['RED', 'BLUE', 'GREEN', 'PURPLE', 'ORANGE', 'BLACK'] as const;

const IDENT = /[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)?/.source;

// A property key is a name followed by its `:`, or a bare flag: a name standing
// alone before whatever ends the entry. Inline a `,` ends an entry too; in a
// block it never does, because there commas belong to the value.
const INLINE_KEY = new RegExp(`${IDENT}(?=\\s*(?::|,|;|\\}|\\/\\/|$))`);
const BLOCK_KEY = `(${IDENT})(?=\\s*(?::|;|\\}|\\/\\/|$))`;

type ExpandedAction = monaco.languages.IExpandedMonarchLanguageAction;
type Rule = monaco.languages.IMonarchLanguageRule;
type Wrap = (token: string, action?: Omit<ExpandedAction, 'token'>) => string | ExpandedAction;

const plain: Wrap = (token, action) => (action ? { token, ...action } : token);

/**
 * An action that also leaves inline metadata when its token is the last on the
 * line: the newline that ends a statement ends its metadata with it. Inline
 * metadata only ever opens at the top level, so leaving it is `@popall`, which
 * also climbs out of any bracket the line left open inside it.
 */
const untilEol: Wrap = (token, action = {}) => ({
    cases: {
        '@eos': { token, next: '@popall' },
        '@default': { token, ...action },
    },
});

/** Everything that may appear inside an expression, wherever it is. */
const expressionRules = (wrap: Wrap): Rule[] => [
    [/\/\/.*$/, wrap('comment')],
    [/"(?:[^"\\]|\\.)*"/, wrap('string')],
    [/"(?:[^"\\]|\\.)*$/, wrap('string.invalid')],
    [/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9A-Za-z_])/, wrap('string.color')],
    [/#[0-9A-Za-z_]*/, wrap('invalid')],

    // `min` and `max` are words of the range only straight after `soft`;
    // anywhere else they are the list functions.
    [/(soft)(\s+)(min|max)\b/, [wrap('keyword'), wrap('white'), wrap('keyword')]],
    [/\.\.\.?/, wrap('operator.range')],

    [
        new RegExp(IDENT),
        {
            cases: {
                '@keywords': wrap('keyword'),
                '@palette': wrap('constant.color'),
                '@functions': wrap('predefined'),
                '@constants': wrap('constant'),
                '@default': wrap('identifier'),
            },
        },
    ],

    [/\d+(?:\.\d+)?(?:[eE]-?\d+)?/, wrap('number')],
    [/\.\d+(?:[eE]-?\d+)?/, wrap('number')],

    [/->/, wrap('operator')],
    [/<=|>=|[<>=+\-*/^!|]/, wrap('operator')],
    [/[,:.]/, wrap('delimiter')],
    [/\s+/, wrap('white')],
];

export function createAxisMonarchLanguage(): monaco.languages.IMonarchLanguage {
    return {
        defaultToken: '',
        tokenPostfix: '.axis',

        keywords: [...KEYWORDS],
        palette: [...AXIS_PALETTE_NAMES],
        functions: [...AXIS_FUNCTION_NAMES],
        // `width`, `height` and `index` read like constants, and so does `dt`,
        // the ticker handler's own. `for` and `with` are in the manifest's
        // operators too, but the keyword case catches them first.
        constants: [...AXIS_CONSTANT_NAMES, ...AXIS_OPERATOR_NAMES, 'dt'],

        tokenizer: {
            root: [
                // The block headers whose `{` opens properties rather than
                // statements or an expression.
                [
                    /(config)(\s*)(\{)/,
                    ['keyword', 'white', { token: '@brackets', next: '@propertiesStart' }],
                ],
                [
                    new RegExp(`(style)(\\s+)(${IDENT})(\\s*)(\\{)`),
                    [
                        'keyword',
                        'white',
                        'type',
                        'white',
                        { token: '@brackets', next: '@propertiesStart' },
                    ],
                ],
                [new RegExp(`(style)(\\s+)(${IDENT})`), ['keyword', 'white', 'type']],
                [new RegExp(`(macro)(\\s+)(${IDENT})`), ['keyword', 'white', 'function']],

                [/@\{/, { token: 'keyword.metadata', bracket: '@open', next: '@propertiesStart' }],
                [
                    /@/,
                    {
                        cases: {
                            '@eos': 'keyword.metadata',
                            '@default': { token: 'keyword.metadata', next: '@metaKey' },
                        },
                    },
                ],

                [/;/, 'delimiter'],
                // The top level does not nest its brackets: the `}` closing a
                // folder or a table is just a bracket, and a piecewise spread
                // over lines colours the same either way.
                [/[{}()[\]]/, '@brackets'],
                ...expressionRules(plain),
            ],

            // ── Metadata written inline: `@ key: value, flag` ───────────────
            // A comma leads back to `metaKey`, which takes the next name as a
            // key only when the comma rule (spec §4.1) says it is one; if not,
            // the comma was part of the value, and so is the name.
            metaKey: [
                [/\s+/, untilEol('white')],
                [INLINE_KEY, untilEol('variable.parameter', { switchTo: '@metaValue' })],
                [/(?=.)/, { token: '', switchTo: '@metaValue' }],
            ],
            metaValue: [
                [/;/, { token: 'delimiter', next: '@pop' }],
                // The brace closing the block the statement sits in ends its
                // metadata, and is left for the state outside to take.
                [/(?=\})/, { token: '', next: '@pop' }],
                [/,/, untilEol('delimiter', { switchTo: '@metaKey' })],
                [/[{([]/, untilEol('@brackets', { next: '@metaNested' })],
                ...expressionRules(untilEol),
            ],
            metaNested: [
                [/[{([]/, { token: '@brackets', next: '@push' }],
                [/[})\]]/, untilEol('@brackets', { next: '@pop' })],
                // Inside a bracket a newline ends nothing, so only the bracket
                // closing at the end of the line can end the metadata.
                ...expressionRules(plain),
            ],

            // ── Properties, one to a line or split by `;` ──────────────────
            // `config { … }`, `style name { … }` and `@{ … }`. A key opens a
            // line, or follows the `{` or a `;`.
            propertiesStart: [
                [/\s+/, 'white'],
                [new RegExp(BLOCK_KEY), { token: 'variable.parameter', switchTo: '@properties' }],
                [/(?=.)/, { token: '', switchTo: '@properties' }],
            ],
            properties: [
                [new RegExp(`^(\\s*)${BLOCK_KEY}`), ['white', 'variable.parameter']],
                [new RegExp(`(;)(\\s*)${BLOCK_KEY}`), ['delimiter', 'white', 'variable.parameter']],
                [/;/, 'delimiter'],
                [/\}/, { token: '@brackets', next: '@pop' }],
                [/[{([]/, { token: '@brackets', next: '@nested' }],
                [/[)\]]/, '@brackets'],
                ...expressionRules(plain),
            ],

            // ── Inside a bracket ───────────────────────────────────────────
            nested: [
                [/[{([]/, { token: '@brackets', next: '@push' }],
                [/[})\]]/, { token: '@brackets', next: '@pop' }],
                [/;/, 'delimiter'],
                ...expressionRules(plain),
            ],
        },
    } as monaco.languages.IMonarchLanguage;
}
