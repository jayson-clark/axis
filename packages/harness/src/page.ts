// ═════════════════════════════════════════════════════════════════════════════
// The harness page — where a real calculator gets to exist
// ═════════════════════════════════════════════════════════════════════════════

import type { Page, Route } from 'playwright-core';
import { DESMOS_SCRIPT_ORIGIN, desmosScriptUrl } from '@axis-dsl/desmos';
import { fetchAsset } from './cache';

/**
 * The page is served *from* desmos.com rather than from a loopback server.
 * Nothing is actually fetched from there — every request is answered out of the
 * on-disk cache — but sharing the origin means calculator.js resolves its own
 * chunks and fonts to URLs the same interceptor recognizes, and no API key
 * referrer rule or cross-origin font policy has anything to object to.
 */
export const HARNESS_URL = `${DESMOS_SCRIPT_ORIGIN}/axis-harness/`;

/** Where the page asks for the calculator, mapped back to the real script. */
const SCRIPT_PATH = `${HARNESS_URL}calculator.js`;

const HARNESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Axis harness</title>
<style>
    html, body { margin: 0; width: 100%; height: 100%; }
    #calculator { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="calculator"></div>
<script src="calculator.js"></script>
</body>
</html>
`;

export interface RoutingOptions {
    apiKey: string;
    offline?: boolean;
}

/** What routing learned while the page loaded, for a failure to report. */
export interface Routing {
    /** Why calculator.js never arrived, if it never arrived. */
    scriptFailure?: string;
}

/**
 * Answer everything the page asks for: the harness document, the calculator
 * script, and whatever else Desmos goes on to load, all from the cache. A
 * request to anywhere else is aborted rather than allowed out — a graph that
 * only renders because it reached some third party is not a graph a test can
 * trust.
 */
export async function installRouting(page: Page, options: RoutingOptions): Promise<Routing> {
    const scriptUrl = desmosScriptUrl(options.apiKey);
    const routing: Routing = {};

    await page.route('**/*', async (route: Route) => {
        const url = route.request().url();

        if (url === HARNESS_URL) {
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: HARNESS_HTML });
        }

        const source = url === SCRIPT_PATH ? scriptUrl : url;
        if (!source.startsWith(`${DESMOS_SCRIPT_ORIGIN}/`)) {
            return route.abort();
        }

        try {
            const asset = await fetchAsset(source, { offline: options.offline });
            await route.fulfill({ contentType: asset.contentType, body: asset.body });
        } catch (error) {
            // Desmos asks for assets it can do without (a locale bundle, a font
            // variant). Failing the request is how the browser is told so. The
            // one request that must succeed is the script, so why *that* one
            // failed is kept: without it all the caller would see is a timeout
            // waiting for a global that was never going to be defined.
            if (source === scriptUrl) {
                routing.scriptFailure = error instanceof Error ? error.message : String(error);
            }
            await route.abort();
        }
    });

    return routing;
}
