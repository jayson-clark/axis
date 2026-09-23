// ═════════════════════════════════════════════════════════════════════════════
// Desmos API constants
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Version of the Desmos calculator API every host loads.
 */
export const DESMOS_API_VERSION = 'v1.13';

/**
 * Origin the calculator is served from. A host that sandboxes the viewer has to
 * name this in its Content-Security-Policy.
 */
export const DESMOS_SCRIPT_ORIGIN = 'https://www.desmos.com';

/**
 * The Axis project's own key, which every host defaults to: the extension's
 * preview, the playground, the docs site and the harness. Desmos' public demo
 * key is for prototyping and not licensed for distribution, so Axis does not
 * use it anywhere. A key is not a secret - it travels in the script's URL on
 * every page that loads the calculator - but anyone building their own product
 * on these packages should get their own at https://www.desmos.com/api.
 */
export const AXIS_DESMOS_API_KEY = '66c0e18dd997410cb8d9efc89b4a82bb';

/** Documentation for the API version this package is written against. */
export const DESMOS_DOCS_URL = `${DESMOS_SCRIPT_ORIGIN}/api/${DESMOS_API_VERSION}/docs/index.html`;

/** URL of the calculator script for a given key. */
export function desmosScriptUrl(apiKey: string): string {
    return `${DESMOS_SCRIPT_ORIGIN}/api/${DESMOS_API_VERSION}/calculator.js?apiKey=${encodeURIComponent(apiKey)}`;
}
