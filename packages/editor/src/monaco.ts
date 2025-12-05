// ═════════════════════════════════════════════════════════════════════════════
// Axis language and themes, registered on a Monaco instance
// ═════════════════════════════════════════════════════════════════════════════
//
// Monaco is a peer, imported for its types only: the instance is passed in by
// the app. That keeps this package out of the business of loading Monaco or
// wiring its web workers, which every bundler does differently, and guarantees
// the app and the editor share one Monaco rather than two copies of it.

import { registerAxisLanguage, type MonacoApi } from '@axis-dsl/language/monaco';

export type { MonacoApi };

export const AXIS_DARK_THEME = 'axis-dark';
export const AXIS_LIGHT_THEME = 'axis-light';

/** Instances already set up, so a second call is a no-op rather than a second registration. */
const configured = new WeakSet<MonacoApi>();

/**
 * Register the Axis language and its two themes on `monaco`.
 *
 * Idempotent per instance. `AxisEditor` calls this itself, so an app only needs
 * it directly when it creates Monaco editors of its own.
 */
export function setupAxis(monaco: MonacoApi): void {
    if (configured.has(monaco)) {
        return;
    }
    configured.add(monaco);

    registerAxisLanguage(monaco);

    monaco.editor.defineTheme(AXIS_DARK_THEME, {
        base: 'vs-dark',
        inherit: true,
        rules: [
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
        ],
        colors: {
            'editor.background': '#16181d',
        },
    });

    monaco.editor.defineTheme(AXIS_LIGHT_THEME, {
        base: 'vs',
        inherit: true,
        rules: [
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
        ],
        colors: {
            'editor.background': '#ffffff',
        },
    });
}
