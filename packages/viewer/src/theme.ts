import type { CSSProperties } from 'react';

/**
 * A style object of CSS custom properties. React passes these straight through
 * to the DOM; `CSSProperties` has no index signature for them, so this is what
 * makes them expressible without casting each key.
 */
export type CssVariables = Record<`--${string}`, string>;

/**
 * Maps the viewer's `--axis-*` theming hooks onto VSCode's theme variables.
 * Applied only inside a webview: elsewhere the `--vscode-*` variables do not
 * exist, and styling against them would render an unthemed panel.
 */
export const VSCODE_THEME_VARS: CSSProperties & CssVariables = {
    '--axis-fg': 'var(--vscode-editor-foreground)',
    '--axis-fg-muted': 'var(--vscode-descriptionForeground)',
    '--axis-surface': 'var(--vscode-editor-background)',
    '--axis-surface-raised': 'var(--vscode-button-secondaryBackground)',
    '--axis-border': 'var(--vscode-panel-border)',
    '--axis-accent': 'var(--vscode-button-background)',
    '--axis-accent-fg': 'var(--vscode-button-foreground)',
    '--axis-danger': 'var(--vscode-errorForeground)',
    '--axis-mono': 'var(--vscode-editor-font-family)',
    '--axis-mono-size': 'var(--vscode-editor-font-size)',
};
