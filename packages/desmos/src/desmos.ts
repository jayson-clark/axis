// ═════════════════════════════════════════════════════════════════════════════
// Desmos API constants
// ═════════════════════════════════════════════════════════════════════════════

/** Version of the Desmos calculator API every host loads. */
export const DESMOS_API_VERSION = 'v1.12';

/**
 * Origin the calculator is served from. A host that sandboxes the viewer - the
 * VSCode webview does - has to name this in its Content-Security-Policy.
 */
export const DESMOS_SCRIPT_ORIGIN = 'https://www.desmos.com';

/**
 * Desmos' public prototyping key. It works with no setup, but logs a console
 * warning and is not licensed for distribution — https://www.desmos.com/api
 */
export const DESMOS_DEMO_API_KEY = 'dcb31709b452b1cf9dc26972add0fda6';

/** Documentation for the API version this package is written against. */
export const DESMOS_DOCS_URL = `${DESMOS_SCRIPT_ORIGIN}/api/${DESMOS_API_VERSION}/docs/index.html`;

/** URL of the calculator script for a given key. */
export function desmosScriptUrl(apiKey: string): string {
    return `${DESMOS_SCRIPT_ORIGIN}/api/${DESMOS_API_VERSION}/calculator.js?apiKey=${encodeURIComponent(apiKey)}`;
}
