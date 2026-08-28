import type { CSSProperties } from 'react';

/**
 * A style object of CSS custom properties. React passes these straight through
 * to the DOM; `CSSProperties` has no index signature for them, so this is what
 * makes them expressible without casting each key.
 */
export type CssVariables = Record<`--${string}`, string>;

/**
 * The viewer's palette, and the only one it has.
 *
 * The viewer used to read its colours from whatever the surrounding host
 * defined, which meant it looked like nothing in particular until each host
 * did the work - and rendered unstyled when a host got a token name wrong or
 * an optional one went undefined. It now brings its own, so it looks the same
 * wherever it is mounted and needs no cooperation to look right.
 *
 * `light-dark()` follows the reader's OS setting, which is why the element
 * carrying these must also set `color-scheme` - {@link AXIS_COLOR_SCHEME} - or
 * every one of them resolves to its light value.
 *
 * A host that genuinely needs different colours can still pass any of these in
 * `style`, which is applied after and therefore wins.
 */
export const AXIS_THEME: CSSProperties & CssVariables = {
    '--axis-fg': 'light-dark(#1c1f26, #e4e7ee)',
    '--axis-fg-muted': 'light-dark(#626a7a, #99a0b0)',
    '--axis-surface': 'light-dark(#ffffff, #16181d)',
    '--axis-surface-raised': 'light-dark(#eceef3, #1e2128)',
    '--axis-border': 'light-dark(#d7dae2, #2a2e37)',
    '--axis-accent': '#2d70b3',
    '--axis-accent-fg': '#ffffff',
    '--axis-danger': 'light-dark(#c03030, #e06c6c)',
    '--axis-font':
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    '--axis-font-size': '13px',
    '--axis-mono': 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    '--axis-mono-size': '12px',
};

/** Required for the `light-dark()` values in {@link AXIS_THEME} to resolve. */
export const AXIS_COLOR_SCHEME = 'light dark';
