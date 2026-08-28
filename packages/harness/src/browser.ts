// ═════════════════════════════════════════════════════════════════════════════
// The shared browser
// ═════════════════════════════════════════════════════════════════════════════
//
// Launching Chromium costs the better part of a second, which is a lot to pay
// per test. One browser is launched lazily and shared by every calculator; it
// shuts down when the last of them closes, so a suite that opens and closes
// calculators never leaves a process behind for Node to wait on.

import { chromium } from 'playwright-core';
import type { Browser, LaunchOptions } from 'playwright-core';

let shared: Promise<Browser> | undefined;
let holders = 0;

/**
 * Playwright ships no browser with `playwright-core`, and the resulting error
 * names an executable path rather than the command that would put one there.
 */
function explainLaunchFailure(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Executable doesn't exist|browserType\.launch/i.test(message)) {
        return error instanceof Error ? error : new Error(message);
    }
    return new Error(
        `Could not launch Chromium for the Axis harness. Install it once with ` +
            `\`pnpm --filter @axis-dsl/harness install-browser\`.\n\n${message}`,
    );
}

/**
 * The shared browser, launching it if it is not up. Every caller must pair this
 * with {@link releaseBrowser}.
 */
export async function acquireBrowser(options: LaunchOptions = {}): Promise<Browser> {
    holders += 1;
    shared ??= chromium.launch({ headless: true, ...options }).catch(error => {
        // A failed launch must not be cached, or every later test in the run
        // would report the same stale rejection.
        shared = undefined;
        throw explainLaunchFailure(error);
    });

    try {
        return await shared;
    } catch (error) {
        holders -= 1;
        throw error;
    }
}

/** Give up a claim on the shared browser, closing it when the last one goes. */
export async function releaseBrowser(): Promise<void> {
    holders = Math.max(0, holders - 1);
    if (holders > 0 || !shared) {
        return;
    }

    const browser = shared;
    shared = undefined;
    await browser.then(
        instance => instance.close(),
        () => undefined,
    );
}
