// ═════════════════════════════════════════════════════════════════════════════
// Monaco themes for Axis
// ═════════════════════════════════════════════════════════════════════════════
//
// The token names below come from the Monarch tokenizer in `monarch.ts`, so
// these themes and that grammar have to move together - which is why they live
// here rather than in an app. Monaco matches a rule to every token its name
// prefixes, so `keyword.axis` colours `keyword.metadata.axis` too unless a
// rule of its own says otherwise.

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
