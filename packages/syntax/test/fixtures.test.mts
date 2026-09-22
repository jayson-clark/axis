import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { debugTree, parse, type Statement } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, 'fixtures');

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
