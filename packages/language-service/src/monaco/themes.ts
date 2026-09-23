// ═════════════════════════════════════════════════════════════════════════════
// Monaco themes for Axis
// ═════════════════════════════════════════════════════════════════════════════
//
// The token names below come from the Monarch tokenizer in `monarch.ts`, so
// these themes and that grammar have to move together - which is why they live
// here rather than in an app. Monaco matches a rule to every token its name
// prefixes, so `keyword.axis` colours `keyword.metadata.axis` too unless a
// rule of its own says otherwise.
//
// The rules without the `.axis` postfix are for the semantic tokens, which
// Monaco matches as `type.modifier.modifier` in the legend's order - so
// `function.defaultLibrary` is a builtin and `variable.readonly` a constant.
// They are coloured as the grammar colours the same things, and the grammar's
// own rules are more specific, so neither steps on the other.

import type * as monaco from 'monaco-editor/editor';

/**
 * The Monaco namespace, passed in so this package never bundles Monaco itself.
 * `monaco-editor/editor` is the editor API alone - the surface these bindings
 * use - so an app that skips Monaco's bundled languages still satisfies it.
 */
export type MonacoApi = typeof monaco;

export const AXIS_DARK_THEME = 'axis-dark';
export const AXIS_LIGHT_THEME = 'axis-light';

const DARK_RULES: monaco.editor.ITokenThemeRule[] = [
    { token: 'comment.axis', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword.axis', foreground: 'c586c0' },
    { token: 'keyword.metadata.axis', foreground: '569cd6' },
    { token: 'predefined.axis', foreground: '4ec9b0' },
    { token: 'function.axis', foreground: 'dcdcaa' },
    { token: 'type.axis', foreground: '4ec9b0' },
    { token: 'constant.axis', foreground: '569cd6' },
    { token: 'constant.color.axis', foreground: '4fc1ff' },
    { token: 'variable.parameter.axis', foreground: '9cdcfe' },
    { token: 'string.axis', foreground: 'ce9178' },
    { token: 'string.color.axis', foreground: 'd7ba7d' },
    { token: 'number.axis', foreground: 'b5cea8' },
    { token: 'operator.axis', foreground: 'd4d4d4' },
    { token: 'operator.range.axis', foreground: 'c586c0' },
    { token: 'invalid.axis', foreground: 'f44747' },

    { token: 'keyword', foreground: 'c586c0' },
    { token: 'function', foreground: 'dcdcaa' },
    { token: 'function.defaultLibrary', foreground: '4ec9b0' },
    { token: 'variable', foreground: '9cdcfe' },
    { token: 'variable.readonly', foreground: '569cd6' },
    { token: 'variable.defaultLibrary', foreground: '569cd6' },
    { token: 'parameter', foreground: '9cdcfe', fontStyle: 'italic' },
    { token: 'property', foreground: '9cdcfe' },
    { token: 'enumMember', foreground: '4fc1ff' },
    { token: 'macro', foreground: 'dcdcaa', fontStyle: 'italic' },
    { token: 'type', foreground: '4ec9b0' },
];

const LIGHT_RULES: monaco.editor.ITokenThemeRule[] = [
    { token: 'comment.axis', foreground: '008000', fontStyle: 'italic' },
    { token: 'keyword.axis', foreground: 'af00db' },
    { token: 'keyword.metadata.axis', foreground: '0000ff' },
    { token: 'predefined.axis', foreground: '267f99' },
    { token: 'function.axis', foreground: '795e26' },
    { token: 'type.axis', foreground: '267f99' },
    { token: 'constant.axis', foreground: '0070c1' },
    { token: 'constant.color.axis', foreground: '0070c1' },
    { token: 'variable.parameter.axis', foreground: '001080' },
    { token: 'string.axis', foreground: 'a31515' },
    { token: 'string.color.axis', foreground: '811f3f' },
    { token: 'number.axis', foreground: '098658' },
    { token: 'operator.axis', foreground: '000000' },
    { token: 'operator.range.axis', foreground: 'af00db' },
    { token: 'invalid.axis', foreground: 'cd3131' },

    { token: 'keyword', foreground: 'af00db' },
    { token: 'function', foreground: '795e26' },
    { token: 'function.defaultLibrary', foreground: '267f99' },
    { token: 'variable', foreground: '001080' },
    { token: 'variable.readonly', foreground: '0070c1' },
    { token: 'variable.defaultLibrary', foreground: '0070c1' },
    { token: 'parameter', foreground: '001080', fontStyle: 'italic' },
    { token: 'property', foreground: '001080' },
    { token: 'enumMember', foreground: '0070c1' },
    { token: 'macro', foreground: '795e26', fontStyle: 'italic' },
    { token: 'type', foreground: '267f99' },
];

/**
 * Define the `axis-dark` and `axis-light` themes on a Monaco instance.
 *
 * Themes are global to the instance: defining them does not select one -
 * `monaco.editor.setTheme(AXIS_DARK_THEME)` does that.
 */
export function defineAxisThemes(api: MonacoApi): void {
    api.editor.defineTheme(AXIS_DARK_THEME, {
        base: 'vs-dark',
        inherit: true,
        rules: DARK_RULES,
        colors: {
            'editor.background': '#16181d',
        },
    });

    api.editor.defineTheme(AXIS_LIGHT_THEME, {
        base: 'vs',
        inherit: true,
        rules: LIGHT_RULES,
        colors: {
            'editor.background': '#ffffff',
        },
    });
}
