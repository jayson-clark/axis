import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { debugTree, parse, type Statement } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, 'fixtures');
const examples = resolve(here, '../../../examples');

/** Every `.axis` file under a directory, however deep. */
const axisFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : axisFiles(path);
        return entry.name.endsWith('.axis') ? [path] : [];
    });

interface AnyNode {
    kind: string;
    span: { start: number; end: number };
}

const isNode = (value: unknown): value is AnyNode =>
    typeof value === 'object' && value !== null && 'kind' in value && 'span' in value;

/**
 * Check every span in a tree: each node lies inside its parent, siblings do not
 * overlap, and a leaf covers exactly the text it was read from.
 */
function checkSpans(node: AnyNode, source: string): void {
    const text = source.slice(node.span.start, node.span.end);
    const leaf = node as AnyNode & { name?: string; value?: string };
    if (node.kind === 'Identifier' && leaf.name) assert.equal(text, leaf.name);
    if (node.kind === 'Number' || node.kind === 'Color') assert.equal(text, leaf.value);
    if (node.kind === 'String') assert.match(text, /^"/);

    const children = Object.values(node)
        .flatMap(value => (Array.isArray(value) ? value : [value]))
        .filter(isNode)
        .sort((a, b) => a.span.start - b.span.start);
    let previousEnd = node.span.start;
    for (const child of children) {
        const where = `${child.kind} in ${node.kind} at ${node.span.start}`;
        assert.ok(child.span.start >= node.span.start, where);
        assert.ok(child.span.end <= node.span.end, where);
        assert.ok(child.span.start >= previousEnd, `overlap: ${where}`);
        previousEnd = child.span.end;
        checkSpans(child, source);
    }
}

/** Every statement in a file, folders opened. */
const flatten = (statements: Statement[]): Statement[] =>
    statements.flatMap(statement =>
        statement.kind === 'FolderStatement'
            ? [statement, ...flatten(statement.body)]
            : [statement],
    );

describe('fixtures', () => {
    for (const name of readdirSync(fixtures).filter(name => name.endsWith('.axis'))) {
        const source = readFileSync(join(fixtures, name), 'utf8');

        test(`${name} parses with no diagnostics`, () => {
            const { diagnostics } = parse(source);
            assert.deepEqual(diagnostics, []);
        });

        test(`${name} round-trips through its tokens`, () => {
            const { tokens } = parse(source);
            assert.equal(tokens.map(token => token.text).join(''), source);
        });

        test(`${name} has every span inside its parent's`, () => {
            checkSpans(parse(source).file, source);
        });

        test(`${name} has no error nodes`, () => {
            const { file } = parse(source);
            assert.doesNotMatch(debugTree(file), /\(error/);
        });

        test(`${name} spans each statement over whole lines of its own text`, () => {
            const { file } = parse(source);
            for (const statement of flatten(file.statements)) {
                const text = source.slice(statement.span.start, statement.span.end);
                assert.equal(text, text.trim(), `untrimmed span: ${JSON.stringify(text)}`);
                assert.ok(!text.startsWith('//'), 'a span starts in a comment');
            }
        });
    }

    test('every statement kind appears in some fixture', () => {
        const kinds = new Set<string>();
        for (const name of readdirSync(fixtures).filter(name => name.endsWith('.axis'))) {
            const { file } = parse(readFileSync(join(fixtures, name), 'utf8'));
            for (const statement of flatten(file.statements)) kinds.add(statement.kind);
        }
        assert.deepEqual([...kinds].sort(), [
            'ConfigStatement',
            'ExpressionStatement',
            'FolderStatement',
            'ImageStatement',
            'ImportStatement',
            'MacroStatement',
            'NoteStatement',
            'StyleStatement',
            'TableStatement',
            'TickerStatement',
        ]);
    });
});

// The examples are the widest use of the language there is: every one of them
// should read without a single complaint.
describe('examples', () => {
    for (const path of axisFiles(examples)) {
        test(`${path.slice(examples.length + 1)} parses cleanly`, () => {
            const source = readFileSync(path, 'utf8');
            const { file, diagnostics, tokens } = parse(source);
            assert.deepEqual(diagnostics, []);
            assert.doesNotMatch(debugTree(file), /\(error/);
            assert.equal(tokens.map(token => token.text).join(''), source);
            checkSpans(file, source);
        });
    }
});
