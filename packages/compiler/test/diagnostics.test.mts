// ═════════════════════════════════════════════════════════════════════════════
// The diagnostic catalogues - against their examples, and against the spec
// ═════════════════════════════════════════════════════════════════════════════
//
// Every code the compiler can report is declared in a catalogue, syntax's or
// this package's, and the reporting functions take nothing else - so the
// catalogues are complete by construction. What is left to test is that each
// example raises exactly the code it is filed under, and that the spec's §8
// and §11 tables say the same thing the catalogues do, code for code and
// word for word.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SYNTAX_DIAGNOSTICS } from '@axis-dsl/syntax';
import { COMPILER_DIAGNOSTICS, DECOMPILER_DIAGNOSTICS } from '../dist/index.js';
import { compileAxis } from './support/compile.mts';
import { EXAMPLES_DIRECTORY, exampleOptions, resolveImport } from './support/examples.mts';

/** Where the catalogue's examples are compiled, beside the examples. */
const GRAPH = resolve(EXAMPLES_DIRECTORY, 'graph.axis');

describe('the compiler diagnostics catalogue', () => {
    for (const [code, info] of Object.entries(COMPILER_DIAGNOSTICS)) {
        test(`${code}: the example raises it and nothing else`, () => {
            const options = exampleOptions(GRAPH);
            // `graph.axis` is not on disk; the one example that imports it is
            // importing itself.
            options.resolveImport = (specifier, from) =>
                resolve(from, '..', `${specifier}.axis`) === GRAPH
                    ? { path: GRAPH, source: info.example }
                    : resolveImport(specifier, from);
            const codes = new Set(compileAxis(info.example, options).diagnostics.map(d => d.code));

            assert.deepEqual([...codes], [code]);
        });
    }
});

/**
 * The rows of the table that follows `heading` in the spec, as code →
 * summary: `| \`code\` | summary |`.
 */
function specTable(heading: string): Record<string, string> {
    const spec = readFileSync(new URL('../../../docs/spec.md', import.meta.url), 'utf8');
    const start = spec.indexOf(heading);
    assert.ok(start >= 0, `the spec has no "${heading}"`);
    const rows: Record<string, string> = {};
    let inTable = false;
    for (const line of spec.slice(start).split('\n').slice(1)) {
        const row = /^\| `([a-z-]+)` +\| (.*?) *\|$/.exec(line);
        if (row) {
            inTable = true;
            rows[row[1]] = row[2];
        } else if (inTable && !line.startsWith('|')) {
            break;
        }
    }
    return rows;
}

const summaries = (catalogue: Record<string, { summary: string }>) =>
    Object.fromEntries(Object.entries(catalogue).map(([code, info]) => [code, info.summary]));

describe('the spec lists exactly the catalogued codes', () => {
    test('§8, the lexer and the parser', () => {
        assert.deepEqual(
            specTable('The lexer and parser report these codes'),
            summaries(SYNTAX_DIAGNOSTICS),
        );
    });

    test('§8, the checker and the compiler', () => {
        assert.deepEqual(
            specTable('The checker and the compiler report these codes'),
            summaries(COMPILER_DIAGNOSTICS),
        );
    });

    test('§11, the decompiler', () => {
        assert.deepEqual(specTable('## 11. Decompiling'), summaries(DECOMPILER_DIAGNOSTICS));
    });
});
