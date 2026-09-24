import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYWORDS, lex, unescapeString, type Token } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Every token but the trivia, as `kind:text`, for compact assertions. */
const significant = (source: string) =>
    lex(source)
        .tokens.filter(token => token.kind !== 'whitespace' && token.kind !== 'eof')
        .map(token => `${token.kind}:${token.text}`);

const kinds = (source: string) => significant(source).map(entry => entry.split(':')[0]);

const roundTrips = (source: string) => {
    const { tokens } = lex(source);
    assert.equal(tokens.map(token => token.text).join(''), source);
    // Spans tile the source: each starts where the last ended.
    let at = 0;
    for (const token of tokens) {
        assert.equal(token.span.start, at);
        assert.equal(source.slice(token.span.start, token.span.end), token.text);
        at = token.span.end;
    }
    assert.equal(at, source.length);
    assert.equal(tokens[tokens.length - 1].kind, 'eof');
};

/** Every `.axis` file under a directory, however deep. */
function axisFiles(directory: string): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory).flatMap(name => {
        if (name === 'node_modules') return [];
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return axisFiles(path);
        return name.endsWith('.axis') ? [path] : [];
    });
}

describe('lexer round trip', () => {
    test('the empty source is one eof token', () => {
        const { tokens, diagnostics } = lex('');
        assert.deepEqual(tokens, [{ kind: 'eof', text: '', span: { start: 0, end: 0 } }]);
        assert.deepEqual(diagnostics, []);
    });

    test('a source full of trivia and junk still round-trips', () => {
        for (const source of [
            'y = x // a comment\n\n\t  z = 2\r\n',
            '"unterminated\nnext',
            '#zz $ € 😀 _ ~ "a\\q"',
            '...... ..→ @{@ { -> <= >=',
        ]) {
            roundTrips(source);
        }
    });

    // Every example, and every fixture: the lexer hands back exactly what it
    // was given.
    const examples = resolve(here, '../../../examples');
    for (const path of axisFiles(examples)) {
        test(`round-trips ${path.slice(examples.length + 1)}`, () => {
            roundTrips(readFileSync(path, 'utf8'));
        });
    }

    for (const path of axisFiles(resolve(here, 'fixtures'))) {
        test(`round-trips fixture ${path.split('/').pop()} with no diagnostics`, () => {
            const source = readFileSync(path, 'utf8');
            roundTrips(source);
            assert.deepEqual(lex(source).diagnostics, []);
        });
    }
});

describe('tokens', () => {
    test('numbers', () => {
        assert.deepEqual(significant('3 0.5 .5 1e-3 2e5 12.25'), [
            'number:3',
            'number:0.5',
            'number:.5',
            'number:1e-3',
            'number:2e5',
            'number:12.25',
        ]);
    });

    test('an exponent needs a digit after it, so 2e is the product of 2 and e', () => {
        assert.deepEqual(significant('2e'), ['number:2', 'identifier:e']);
        assert.deepEqual(significant('2e-x'), [
            'number:2',
            'identifier:e',
            'punctuation:-',
            'identifier:x',
        ]);
        assert.deepEqual(significant('2exp'), ['number:2', 'identifier:exp']);
    });

    test('a number has no sign', () => {
        assert.deepEqual(significant('-3'), ['punctuation:-', 'number:3']);
    });

    test('.. and ... are distinct from each other and from a decimal point', () => {
        assert.deepEqual(significant('0..5'), ['number:0', 'punctuation:..', 'number:5']);
        assert.deepEqual(significant('1...10'), ['number:1', 'punctuation:...', 'number:10']);
        assert.deepEqual(significant('..5'), ['punctuation:..', 'number:5']);
        assert.deepEqual(significant('a.x'), ['identifier:a', 'punctuation:.', 'identifier:x']);
        assert.deepEqual(significant('x.5'), ['identifier:x', 'number:.5']);
    });

    test('identifiers, with one optional subscript', () => {
        assert.deepEqual(significant('x amp x_1 x_12 theta2 L1 v_max'), [
            'identifier:x',
            'identifier:amp',
            'identifier:x_1',
            'identifier:x_12',
            'identifier:theta2',
            'identifier:L1',
            'identifier:v_max',
        ]);
    });

    test('more than one subscript is one name, for enum values', () => {
        assert.deepEqual(significant('LOOP_FORWARD_REVERSE x_1_2'), [
            'identifier:LOOP_FORWARD_REVERSE',
            'identifier:x_1_2',
        ]);
    });

    test('an underscore with nothing after it is not part of the name', () => {
        assert.deepEqual(kinds('x_'), ['identifier', 'error']);
        assert.equal(lex('x_').diagnostics[0].code, 'unexpected-character');
    });

    test('every keyword is a keyword, and min and max are not', () => {
        for (const keyword of KEYWORDS) {
            assert.deepEqual(significant(keyword), [`keyword:${keyword}`]);
        }
        assert.deepEqual(kinds('min max true false'), [
            'identifier',
            'identifier',
            'identifier',
            'identifier',
        ]);
        // A keyword is a whole word only.
        assert.deepEqual(significant('folders step_1'), [
            'identifier:folders',
            'identifier:step_1',
        ]);
    });

    test('strings, with their escapes', () => {
        const source = '"a \\"b\\" c\\\\ \\n"';
        assert.deepEqual(kinds(source), ['string']);
        assert.equal(unescapeString(lex(source).tokens[0].text), 'a "b" c\\ \n');
        assert.deepEqual(lex(source).diagnostics, []);
    });

    test('an unknown escape is reported and read as the character itself', () => {
        const { tokens, diagnostics } = lex('"a\\qb"');
        assert.equal(tokens[0].kind, 'string');
        assert.deepEqual(
            diagnostics.map(d => [d.code, d.span]),
            [['invalid-escape', { start: 2, end: 4 }]],
        );
        assert.equal(unescapeString(tokens[0].text), 'aqb');
    });

    test('an unterminated string ends at the end of its line', () => {
        const { tokens, diagnostics } = lex('"abc\ny');
        assert.deepEqual(
            tokens.map(token => [token.kind, token.text]),
            [
                ['string', '"abc'],
                ['newline', '\n'],
                ['identifier', 'y'],
                ['eof', ''],
            ],
        );
        assert.deepEqual(
            diagnostics.map(d => [d.code, d.span]),
            [['unterminated-string', { start: 0, end: 4 }]],
        );
        assert.equal(unescapeString('"abc'), 'abc');
        assert.equal(unescapeString('"ab\\"'), 'ab"');
    });

    test('colours are # and exactly 3 or 6 hex digits', () => {
        assert.deepEqual(significant('#c74440 #fff #FFF'), [
            'color:#c74440',
            'color:#fff',
            'color:#FFF',
        ]);
        for (const bad of ['#ff00', '#ggg', '#', '#1234567', '#fffx']) {
            const { tokens, diagnostics } = lex(bad);
            assert.deepEqual(
                tokens.map(token => token.kind),
                ['error', 'eof'],
                bad,
            );
            assert.equal(diagnostics[0].code, 'invalid-color', bad);
            assert.deepEqual(diagnostics[0].span, { start: 0, end: bad.length });
        }
    });

    test('punctuation, longest first', () => {
        assert.deepEqual(
            significant('( ) [ ] { } , ; : . .. ... = < <= > >= + - * / ^ ! | -> @ @{').map(entry =>
                entry.slice('punctuation:'.length),
            ),
            '( ) [ ] { } , ; : . .. ... = < <= > >= + - * / ^ ! | -> @ @{'.split(' '),
        );
    });

    test('@{ is one token only with nothing between', () => {
        assert.deepEqual(significant('@{'), ['punctuation:@{']);
        assert.deepEqual(significant('@ {'), ['punctuation:@', 'punctuation:{']);
    });

    test('a - > is not an arrow, and a -> is', () => {
        assert.deepEqual(significant('a->b'), ['identifier:a', 'punctuation:->', 'identifier:b']);
        assert.deepEqual(significant('a- >b'), [
            'identifier:a',
            'punctuation:-',
            'punctuation:>',
            'identifier:b',
        ]);
    });

    test('trivia: whitespace, comments, and newlines, which are not trivia', () => {
        const { tokens } = lex('a  // note\r\n\tb');
        assert.deepEqual(
            tokens.map(token => token.kind),
            [
                'identifier',
                'whitespace',
                'comment',
                'whitespace',
                'newline',
                'whitespace',
                'identifier',
                'eof',
            ],
        );
        assert.equal(tokens[2].text, '// note');
        assert.equal(tokens[3].text, '\r');
    });

    test('a comment stops before the newline', () => {
        const tokens: Token[] = lex('// c\nx').tokens;
        assert.deepEqual(
            tokens.map(token => token.text),
            ['// c', '\n', 'x', ''],
        );
    });

    test('a geometry token is `$` and digits, and one name', () => {
        assert.deepEqual(kinds('$12 + $3'), ['identifier', 'punctuation', 'identifier']);
        assert.equal(lex('$12').tokens[0].text, '$12');
        assert.deepEqual(
            lex('$x').diagnostics.map(d => d.code),
            ['unexpected-character'],
        );
    });

    test('a run of unknown characters is one error', () => {
        const { tokens, diagnostics } = lex('a $%& b');
        assert.deepEqual(kinds('a $%& b'), ['identifier', 'error', 'identifier']);
        assert.equal(tokens[2].text, '$%&');
        assert.deepEqual(
            diagnostics.map(d => [d.code, d.span]),
            [['unexpected-character', { start: 2, end: 5 }]],
        );
    });

    test('never throws, whatever it is given', () => {
        let source = '';
        const alphabet = 'ab1.#"\\\n ;,:{}()[]@-><=|!^/*+_e$';
        let seed = 7;
        for (let i = 0; i < 2000; i++) {
            seed = (seed * 1103515245 + 12345) % 2 ** 31;
            source += alphabet[seed % alphabet.length];
        }
        roundTrips(source);
    });
});
