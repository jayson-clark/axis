// ═════════════════════════════════════════════════════════════════════════════
// Every script the docs show, compiled
// ═════════════════════════════════════════════════════════════════════════════
//
// A code block on the site is a claim about the language. The hand-written ones
// - the site's pages, the spec's, the keywords' hover - are gathered by
// `docs/site/scripts/blocks.mts`, and each has to compile with nothing to report,
// or, if it is there to show a mistake, report exactly the one it says. The
// manifest's examples are `manifest.test.mts`'s; whether Desmos draws any of
// them is the harness' `docs.test.mts`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { documentationBlocks } from '../../../docs/site/scripts/blocks.mts';
import { compileAxis } from './support/compile.mts';
import { exampleOptions } from './support/examples.mts';

describe('every axis block in the docs', () => {
    const blocks = documentationBlocks();

    test('there are some', () => {
        assert.ok(blocks.length > 0);
    });

    for (const block of blocks) {
        const expected = block.error ? [block.error] : [];

        test(`${block.where} ${block.error ? `raises ${block.error}` : 'compiles cleanly'}`, () => {
            const { diagnostics } = compileAxis(block.source, exampleOptions());
            const codes = [...new Set(diagnostics.map(diagnostic => diagnostic.code))];

            assert.deepEqual(
                codes,
                expected,
                diagnostics
                    .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
                    .join('\n'),
            );
        });
    }
});
