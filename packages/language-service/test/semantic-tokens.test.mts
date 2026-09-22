import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@axis-dsl/syntax';
import {
    getSemanticTokenList,
    getSemanticTokens,
    SEMANTIC_TOKEN_LEGEND,
    SEMANTIC_TOKEN_MODIFIERS,
    SEMANTIC_TOKEN_TYPES,
} from '../dist/index.js';
import { examples, textOf } from './support.mts';
import { resolveFrom } from './imports.mts';

/** Each token as `text:type.modifier…`, for comparing at a glance. */
const tokens = (source: string, options = {}) =>
    getSemanticTokenList(source, options).map(
        token => `${textOf(source, token.range)}:${[token.type, ...token.modifiers].join('.')}`,
    );

/** How one word, the `n`th of its spelling, is classified. */
const classOf = (source: string, word: string, n = 0) =>
    tokens(source)
        .filter(token => token.startsWith(`${word}:`))
        [n]?.slice(word.length + 1);

describe('the legend', () => {
    test('lists the types and modifiers the service uses', () => {
        assert.deepEqual(SEMANTIC_TOKEN_LEGEND.tokenTypes, [...SEMANTIC_TOKEN_TYPES]);
        assert.deepEqual(SEMANTIC_TOKEN_LEGEND.tokenModifiers, [...SEMANTIC_TOKEN_MODIFIERS]);
        for (const type of [
            'keyword',
            'function',
            'variable',
            'parameter',
            'property',
            'enumMember',
            'string',
            'number',
            'comment',
            'operator',
            'macro',
            'type',
        ]) {
            assert.ok(SEMANTIC_TOKEN_TYPES.includes(type as never), type);
        }
        assert.deepEqual([...SEMANTIC_TOKEN_MODIFIERS].sort(), [
            'declaration',
            'defaultLibrary',
            'readonly',
        ]);
    });
});

describe('classifying tokens', () => {
    test('tells builtin functions from user ones', () => {
        const source = 'f(x) = sin(x)\ny = f(2)';
        assert.equal(classOf(source, 'sin'), 'function.defaultLibrary');
        assert.equal(classOf(source, 'f'), 'function.declaration');
        assert.equal(classOf(source, 'f', 1), 'function');
    });

    test('tells a parameter from the global of the same name', () => {
        const source = 'a = 1\nf(a) = a + 1\ny = a';
        assert.equal(classOf(source, 'a'), 'variable.declaration');
        assert.equal(classOf(source, 'a', 1), 'parameter.declaration');
        assert.equal(classOf(source, 'a', 2), 'parameter');
        assert.equal(classOf(source, 'a', 3), 'variable');
    });

    test('marks constants readonly, and builtins as the default library', () => {
        assert.equal(classOf('y = pi x', 'pi'), 'variable.readonly.defaultLibrary');
        assert.equal(classOf('ticker n -> n + dt', 'dt'), 'variable.defaultLibrary');
    });

    test('colours properties, their enum values and palette names', () => {
        const source = 'y = x @ color: RED, lineStyle: dashed, lineWidth: RED';
        assert.equal(classOf(source, 'color'), 'property');
        assert.equal(classOf(source, 'RED'), 'enumMember.readonly');
        assert.equal(classOf(source, 'dashed'), 'enumMember.readonly');
        // A palette name is only a palette name as a colour's value.
        assert.equal(classOf(source, 'RED', 1), 'variable');
    });

    test('colours styles as types, where they are defined and used', () => {
        const source = 'style loud { color: RED }\ny = x @ use: loud';
        assert.equal(classOf(source, 'loud'), 'type.declaration');
        assert.equal(classOf(source, 'loud', 1), 'type');
    });

    test('colours macros and their parameters', () => {
        const source = 'macro wave(k) = sin(k x)\ny = wave(2)';
        assert.equal(classOf(source, 'wave'), 'macro.declaration');
        assert.equal(classOf(source, 'k'), 'parameter.declaration');
        assert.equal(classOf(source, 'k', 1), 'parameter');
        assert.equal(classOf(source, 'wave', 1), 'macro');
    });

    test('colours keywords, strings, numbers, comments and operators off the lexer', () => {
        const source = 'folder "A" { a = 1.5 -> 2 } // done';
        assert.deepEqual(tokens(source), [
            'folder:keyword',
            '"A":string',
            'a:variable.declaration',
            '=:operator',
            '1.5:number',
            '->:operator',
            '2:number',
            '// done:comment',
        ]);
    });

    test('colours `min` and `max` after `soft` as keywords, and nowhere else', () => {
        assert.equal(classOf('a = 1 @ slider: 0..1 soft min', 'min'), 'keyword');
        assert.equal(classOf('m = min([1, 2])', 'min'), 'function.defaultLibrary');
    });

    test('colours a name an import defines as what it is there', () => {
        const options = {
            path: '/main.axis',
            resolveImport: resolveFrom({ '/lib.axis': 'wave(x) = sin(x)' }),
        };
        const source = 'import "./lib"\ny = wave(x)';
        assert.ok(tokens(source, options).includes('wave:function'));
        assert.ok(tokens(source).includes('wave:variable'));
    });
});

describe('encoding', () => {
    test('encodes five integers a token, each relative to the last', () => {
        const source = 'a = 1\n  b = a';
        const { data } = getSemanticTokens(source);
        assert.equal(data.length % 5, 0);
        const type = (name: string) => SEMANTIC_TOKEN_TYPES.indexOf(name as never);
        const declaration = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf('declaration');
        assert.deepEqual(data.slice(0, 5), [0, 0, 1, type('variable'), declaration]);
        // `b`: one line down, at character 2 - absolute, since the line moved.
        assert.deepEqual(data.slice(15, 20), [1, 2, 1, type('variable'), declaration]);
        // `=` after it: the same line, two characters on.
        assert.deepEqual(data.slice(20, 25), [0, 2, 1, type('operator'), 0]);
    });

    test('decodes back to the token list', () => {
        const source = 'f(x) = x^2 @ color: BLUE\n// a comment\nticker n -> n + dt';
        const list = getSemanticTokenList(source);
        const { data } = getSemanticTokens(source);
        let line = 0;
        let character = 0;
        for (let i = 0; i < data.length; i += 5) {
            line += data[i];
            character = data[i] === 0 ? character + data[i + 1] : data[i + 1];
            const token = list[i / 5];
            assert.deepEqual(token.range.start, { line, character });
            assert.equal(token.range.end.character - character, data[i + 2]);
            assert.equal(SEMANTIC_TOKEN_TYPES[data[i + 3]], token.type);
        }
    });
});

describe('semantic tokens over the examples', () => {
    for (const { name, source } of examples) {
        test(`classify every name in ${name}`, () => {
            const tree = parse(source);
            const classified = new Set(
                getSemanticTokenList(tree).map(
                    token => `${token.range.start.line}:${token.range.start.character}`,
                ),
            );
            const lines = source.split('\n');
            for (const token of tree.tokens) {
                if (token.kind !== 'identifier' && token.kind !== 'keyword') continue;
                const before = source.slice(0, token.span.start).split('\n');
                const key = `${before.length - 1}:${before.at(-1)!.length}`;
                assert.ok(
                    classified.has(key),
                    `${token.text} on line ${before.length}: ${lines[before.length - 1]}`,
                );
            }
        });
    }
});
