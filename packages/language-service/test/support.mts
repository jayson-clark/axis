// Shared helpers for the language service suites: a cursor written into the
// source as `|`, and the example scripts.

import { readdirSync, readFileSync } from 'node:fs';
import type { Position, Range } from '../dist/index.js';

/**
 * A source with the cursor marked by the one `|` in it - which Axis also uses
 * for absolute values, so a test that wants one of those writes `¦` for the
 * cursor instead.
 */
export function cursor(marked: string): { source: string; position: Position; offset: number } {
    const marker = marked.includes('¦') ? '¦' : '|';
    const offset = marked.indexOf(marker);
    if (offset < 0) throw new Error(`no cursor in ${JSON.stringify(marked)}`);
    const source = marked.slice(0, offset) + marked.slice(offset + 1);
    const before = source.slice(0, offset).split('\n');
    return {
        source,
        offset,
        position: { line: before.length - 1, character: before.at(-1)!.length },
    };
}

/** The position of the `n`th occurrence of `needle`, `delta` characters into it. */
export function positionOf(source: string, needle: string, n = 0, delta = 0): Position {
    let at = -1;
    for (let k = 0; k <= n; k++) {
        at = source.indexOf(needle, at + 1);
        if (at < 0) throw new Error(`${needle} #${n} not in source`);
    }
    const before = source.slice(0, at + delta).split('\n');
    return { line: before.length - 1, character: before.at(-1)!.length };
}

/** The text a range covers. */
export function textOf(source: string, range: Range): string {
    const lines = source.split('\n');
    const offset = (p: Position) =>
        lines.slice(0, p.line).reduce((sum, line) => sum + line.length + 1, 0) + p.character;
    return source.slice(offset(range.start), offset(range.end));
}

const EXAMPLES = new URL('../../../examples/scripts/', import.meta.url);

/** Every example script, and the libraries they import. */
export const examples: { name: string; source: string }[] = [
    ...readdirSync(EXAMPLES)
        .filter(name => name.endsWith('.axis'))
        .map(name => ({ name, source: readFileSync(new URL(name, EXAMPLES), 'utf8') })),
    ...readdirSync(new URL('lib/', EXAMPLES))
        .filter(name => name.endsWith('.axis'))
        .map(name => ({
            name: `lib/${name}`,
            source: readFileSync(new URL(`lib/${name}`, EXAMPLES), 'utf8'),
        })),
];
