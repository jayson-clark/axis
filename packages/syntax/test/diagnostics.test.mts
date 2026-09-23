// ═════════════════════════════════════════════════════════════════════════════
// The lexer's and parser's catalogue - every example raises its own code
// ═════════════════════════════════════════════════════════════════════════════
//
// `SYNTAX_DIAGNOSTICS` is what the docs site lists, each code with a file
// that raises it. An example that raises nothing, or something else as well,
// is a page of the reference showing the wrong mistake. That the spec's table
// agrees is the compiler's test, which can see both catalogues.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse, SYNTAX_DIAGNOSTICS, type SyntaxDiagnosticCode } from '../dist/index.js';

describe('the syntax diagnostics catalogue', () => {
    for (const [code, info] of Object.entries(SYNTAX_DIAGNOSTICS)) {
        test(`${code}: the example raises it and nothing else`, () => {
            const codes = new Set(parse(info.example).diagnostics.map(d => d.code));

            assert.deepEqual([...codes], [code as SyntaxDiagnosticCode]);
        });
    }
});
