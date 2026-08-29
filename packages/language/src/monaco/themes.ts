// ═════════════════════════════════════════════════════════════════════════════
// Monaco themes for Axis
// ═════════════════════════════════════════════════════════════════════════════
//
// The token names below come from the Monarch tokenizer in `monarch.ts`, so
// these themes and that grammar have to move together — which is why they live
// here rather than in an app.

import type * as monaco from 'monaco-editor/editor';
import type { MonacoApi } from './types';

export const AXIS_DARK_THEME = 'axis-dark';
export const AXIS_LIGHT_THEME = 'axis-light';

const DARK_RULES: monaco.editor.ITokenThemeRule[] = [
    { token: 'comment.axis', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword.axis', foreground: 'c586c0' },
    { token: 'predefined.axis', foreground: '4ec9b0' },
    { token: 'constant.axis', foreground: '569cd6' },
    { token: 'variable.parameter.axis', foreground: '9cdcfe' },
    { token: 'attribute.name.axis', foreground: '9cdcfe' },
    { token: 'attribute.value.axis', foreground: 'ce9178' },
    { token: 'string.axis', foreground: 'ce9178' },
    { token: 'number.axis', foreground: 'b5cea8' },
    { token: 'operator.axis', foreground: 'd4d4d4' },
];

const LIGHT_RULES: monaco.editor.ITokenThemeRule[] = [
    { token: 'comment.axis', foreground: '008000', fontStyle: 'italic' },
    { token: 'keyword.axis', foreground: 'af00db' },
    { token: 'predefined.axis', foreground: '267f99' },
    { token: 'constant.axis', foreground: '0070c1' },
    { token: 'variable.parameter.axis', foreground: '001080' },
    { token: 'attribute.name.axis', foreground: '001080' },
    { token: 'attribute.value.axis', foreground: 'a31515' },
    { token: 'string.axis', foreground: 'a31515' },
    { token: 'number.axis', foreground: '098658' },
    { token: 'operator.axis', foreground: '000000' },
];

/**
 * Define the `axis-dark` and `axis-light` themes on a Monaco instance.
 *
 * `registerAxisLanguage` calls this, so an app only needs it directly if it
 * registers the language some other way. Themes are global to the instance:
 * defining them does not select one — `monaco.editor.setTheme(AXIS_DARK_THEME)`
 * does that.
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
