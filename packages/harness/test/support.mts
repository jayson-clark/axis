// Shared setup for the suites that need a real calculator.

import { before, after } from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createCalculator } from '../dist/index.js';
import type { AxisCalculator, AxisCalculatorOptions } from '../dist/index.js';

/**
 * Chromium is a 100MB download, so it is installed on demand rather than by
 * `pnpm install`. Without it these suites skip with a message that says how to
 * get one, instead of failing a clone that has never asked for a browser.
 */
function chromiumInstalled(): boolean {
    try {
        return existsSync(chromium.executablePath());
    } catch {
        return false;
    }
}

export const skip: false | string = chromiumInstalled()
    ? false
    : 'Chromium is not installed — run `pnpm --filter @axis-dsl/harness install-browser`';

/**
 * One calculator for the enclosing suite. Launching Chromium and loading
 * calculator.js is the expensive part of a run, and every `load` replaces the
 * whole graph, so tests share one rather than each paying for their own.
 */
export function useCalculator(options?: AxisCalculatorOptions): () => AxisCalculator {
    let calculator: AxisCalculator | undefined;

    before(async () => {
        calculator = await createCalculator(options);
    });

    after(async () => {
        await calculator?.close();
    });

    return () => {
        if (!calculator) {
            throw new Error('The calculator is only available inside a test');
        }
        return calculator;
    };
}

/** The directory the example scripts live in. */
export function exampleDirectory(): string {
    return fileURLToPath(new URL('../../../examples/scripts/', import.meta.url));
}

/** Path to one of the scripts in `examples/`. */
export function example(name: string): string {
    return fileURLToPath(new URL(`../../../examples/scripts/${name}`, import.meta.url));
}
