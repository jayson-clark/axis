// ═════════════════════════════════════════════════════════════════════════════
// The documentation's examples, on the calculator they are promises about
// ═════════════════════════════════════════════════════════════════════════════
//
// Every example the manifest carries is shown by hover and printed in the docs
// site's reference. The compiler's own suite has already said each one
// compiles cleanly; this says Desmos draws it - no expression in error, and no
// console error from the page. An example is read as though it sat in
// `examples/scripts/`, so an import of `./lib/waves` or a picture of
// `./images/wave.png` is the real file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { AXIS_MANIFEST } from '@axis-dsl/syntax';
import { loadAxisSource, type AxisCalculator } from '../dist/index.js';
import { exampleDirectory, skip, useCalculator } from './support.mts';

/** Load `source` beside the example scripts and say what Desmos objected to. */
async function problemsWith(calculator: AxisCalculator, source: string): Promise<string[]> {
    const script = await loadAxisSource(source, resolve(exampleDirectory(), 'example.axis'));
    // The page's console errors are kept for the calculator's whole life.
    const before = calculator.consoleErrors().length;
    const { diagnostics } = await calculator.load(script.source, script);
    const inspection = await calculator.inspect();
    return [
        ...diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`),
        ...inspection.errors.map(error => `${error.latex}: ${error.message}`),
        ...inspection.consoleErrors.slice(before),
    ];
}

const SECTIONS = [
    'functions',
    'operators',
    'constants',
    'metadata',
    'tickerProperties',
    'configProperties',
] as const;

describe('every example in the manifest is a graph Desmos draws', { skip }, () => {
    const calculator = useCalculator();

    for (const section of SECTIONS) {
        for (const entry of AXIS_MANIFEST[section]) {
            if (entry.example === undefined) continue;
            const example = entry.example;

            test(`${section} ${entry.name}`, async () => {
                assert.deepEqual(await problemsWith(calculator(), example), []);
            });
        }
    }
});
