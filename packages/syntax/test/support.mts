// Shared helpers for the syntax suites: parse, insist there were no
// diagnostics, and write the result as an S-expression to compare against.

import assert from 'node:assert/strict';
import { debugTree, parse, parseExpression, type Diagnostic } from '../dist/index.js';

const describeDiagnostics = (diagnostics: Diagnostic[]) =>
    diagnostics.map(d => `${d.code} at ${d.span.start}-${d.span.end}: ${d.message}`).join('\n');

/** A file's statements, one S-expression each, joined by newlines. */
export function tree(source: string): string {
    const { file, diagnostics } = parse(source);
    assert.deepEqual(diagnostics, [], describeDiagnostics(diagnostics));
    return file.statements.map(debugTree).join('\n');
}

/** A lone expression as an S-expression. */
export function expr(source: string): string {
    const { expression, diagnostics } = parseExpression(source);
    assert.deepEqual(diagnostics, [], describeDiagnostics(diagnostics));
    return debugTree(expression);
}

/** A file's tree whatever it reports, and the codes of what it reports. */
export function recover(source: string): { tree: string; codes: string[] } {
    const { file, diagnostics } = parse(source);
    return {
        tree: file.statements.map(debugTree).join('\n'),
        codes: diagnostics.map(d => d.code),
    };
}
