// ═════════════════════════════════════════════════════════════════════════════
// The manifest's examples - every one a script the compiler has nothing to say about
// ═════════════════════════════════════════════════════════════════════════════
//
// Hover shows them and the docs site's reference is built from them, so an
// example that no longer compiles is documentation that lies. Each is compiled
// as though it sat in `examples/scripts/`, where its imports and images are.
// Whether Desmos accepts what comes out is the harness' question
// (`packages/harness/test/docs.test.mts`).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_MANIFEST } from '@axis-dsl/syntax';
import { compileAxis } from './support/compile.mts';
import { exampleOptions } from './support/examples.mts';

const SECTIONS = [
    'functions',
    'operators',
    'constants',
    'metadata',
    'tickerProperties',
    'configProperties',
] as const;

for (const section of SECTIONS) {
    describe(`the manifest's ${section}`, () => {
        for (const entry of AXIS_MANIFEST[section]) {
            if (entry.example === undefined) continue;
            const example = entry.example;

            test(`${entry.name}: the example compiles with no diagnostics`, () => {
                const { diagnostics } = compileAxis(example, exampleOptions());

                assert.deepEqual(
                    diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`),
                    [],
                );
            });

            // A copied example that was never changed is the likely mistake,
            // and it compiles perfectly - it is just about something else.
            test(`${entry.name}: the example uses it`, () => {
                assert.match(example, new RegExp(`(?<!\\w)${entry.name}(?!\\w)`));
            });
        }
    });
}
