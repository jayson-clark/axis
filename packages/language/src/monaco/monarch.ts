import type * as monaco from 'monaco-editor/editor';
import {
    AXIS_CONFIG_PROPERTY_NAMES,
    AXIS_CONSTANT_NAMES,
    AXIS_FUNCTION_NAMES,
    AXIS_MANIFEST,
    AXIS_METADATA_PROPERTY_NAMES,
} from '../index';

/**
 * Monarch grammar for Axis.
 *
 * The TextMate grammar in `@axis-dsl/language/syntaxes` is what VSCode consumes;
 * Monaco cannot read TextMate without an Oniguruma WASM runtime, so this is the
 * browser equivalent. Both draw their word lists from the same manifest, so the
 * two stay in step as the language grows.
 */
export function createAxisMonarchLanguage(): monaco.languages.IMonarchLanguage {
    return {
        defaultToken: '',
        tokenPostfix: '.axis',

        keywords: [...AXIS_MANIFEST.keywords],
        functions: [...AXIS_FUNCTION_NAMES],
        constants: [...AXIS_CONSTANT_NAMES],
        configProperties: [...AXIS_CONFIG_PROPERTY_NAMES],
        metadataProperties: [...AXIS_METADATA_PROPERTY_NAMES],

        operators: ['=', '->', '+', '-', '*', '/', '^', '<', '>', '<=', '>=', '==', '!='],

        symbols: /[=><!~?:&|+\-*/^%]+/,

        tokenizer: {
            root: [
                [/\/\/.*$/, 'comment'],
                [/"/, { token: 'string.quote', next: '@string' }],

                // Hex colours read as `#c74440`, so they have to be matched
                // before the `#` that opens a metadata block.
                [/#[0-9a-fA-F]{3,8}\b/, 'string'],

                // `# key: value, key: value` — metadata is line-scoped, so it is
                // matched in place rather than by pushing a state that would
                // have to be popped at end of line.
                [
                    /(#)(\s*)([a-zA-Z_][a-zA-Z0-9_]*)/,
                    [
                        'keyword',
                        '',
                        {
                            cases: {
                                '@metadataProperties': 'variable.parameter',
                                '@default': 'attribute.name',
                            },
                        },
                    ],
                ],
                [/#/, 'keyword'],

                // A known name immediately followed by `(` is a builtin call.
                [
                    /[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/,
                    {
                        cases: {
                            '@functions': 'predefined',
                            '@keywords': 'keyword',
                            '@default': 'identifier',
                        },
                    },
                ],

                [
                    /[a-zA-Z_][a-zA-Z0-9_]*/,
                    {
                        cases: {
                            '@keywords': 'keyword',
                            '@constants': 'constant',
                            '@configProperties': 'variable.parameter',
                            '@metadataProperties': 'variable.parameter',
                            '@default': 'identifier',
                        },
                    },
                ],

                [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
                [/\d+/, 'number'],

                [/[{}()[\]]/, '@brackets'],
                [
                    /@symbols/,
                    {
                        cases: {
                            '@operators': 'operator',
                            '@default': '',
                        },
                    },
                ],

                [/[;,.]/, 'delimiter'],
                [/\s+/, 'white'],
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, { token: 'string.quote', next: '@pop' }],
            ],
        },
    } as monaco.languages.IMonarchLanguage;
}
