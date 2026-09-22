import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../dist/index.js';
import { recover } from './support.mts';

describe('error recovery', () => {
    test('one bad line does not hide the rest', () => {
        const { tree, codes } = recover('a = 1\ny = x )\nb = 2');
        assert.equal(tree, '(= a 1)\n(= y x)\n(error-statement)\n(= b 2)');
        assert.deepEqual(codes, ['unexpected-token']);
    });

    test('a line that is nothing but junk becomes an error statement', () => {
        const { tree, codes } = recover('a = 1\n) ] *\nb = 2');
        assert.equal(tree, '(= a 1)\n(error-statement)\n(= b 2)');
        assert.deepEqual(codes, ['unexpected-token']);
    });

    test('recovery resyncs at ; as well as at a newline', () => {
        const { tree } = recover('a = ) ; b = 2');
        assert.equal(tree.split('\n').pop(), '(= b 2)');
    });

    test('a missing operand is an error expression', () => {
        const { tree, codes } = recover('y = x +\nz = 1');
        assert.equal(tree, '(= y (+ x (error)))\n(= z 1)');
        assert.deepEqual(codes, ['expected-expression']);
    });

    test('an unclosed bracket costs one line, not the file', () => {
        const { tree, codes } = recover('y = (x + 1\nz = 2');
        assert.equal(tree, '(= y (paren (+ x 1)))\n(= z 2)');
        assert.deepEqual(codes, ['unclosed-bracket']);
    });

    test('an unclosed list and call', () => {
        assert.deepEqual(recover('L = [1, 2\nz = 2').tree.split('\n'), [
            '(= L (list 1 2))',
            '(= z 2)',
        ]);
        assert.deepEqual(recover('y = f(x\nz = 2').tree.split('\n'), [
            '(= y (call f x))',
            '(= z 2)',
        ]);
    });

    test('an unclosed bracket inside a block', () => {
        const { tree, codes } = recover('folder {\n  y = (x\n  z = 1\n}\nw = 2');
        assert.equal(tree, '(folder _ (= y (paren x)) (= z 1))\n(= w 2)');
        assert.deepEqual(codes, ['unclosed-bracket']);
    });

    test('junk inside a closed bracket skips to its closer', () => {
        const { tree, codes } = recover('y = f(a b ; c) + 1\nz = 2');
        assert.equal(tree, '(= y (+ (call f (implicit a b)) 1))\n(= z 2)');
        assert.deepEqual(codes, ['unexpected-token']);
    });

    test('an unclosed block runs to the end of the file, reported', () => {
        const { tree, codes } = recover('folder "a" {\n  y = x\n  z = 1');
        assert.equal(tree, '(folder "a" (= y x) (= z 1))');
        assert.deepEqual(codes, ['unclosed-block']);
    });

    test('an unclosed @{ is reported', () => {
        const { codes } = recover('y = x @{\n  hidden');
        assert.deepEqual(codes, ['unclosed-block']);
    });

    test('a bad statement inside a block does not close the block', () => {
        const { tree, codes } = recover('folder {\n  y = x )\n  z = 1\n}\nw = 2');
        assert.equal(tree, '(folder _ (= y x) (error-statement) (= z 1))\n(= w 2)');
        assert.deepEqual(codes, ['unexpected-token']);
    });

    test('a stray } at the top level', () => {
        const { tree, codes } = recover('a = 1\n}\nb = 2');
        assert.equal(tree, '(= a 1)\n(error-statement)\n(= b 2)');
        assert.deepEqual(codes, ['unexpected-token']);
    });

    test('a missing value', () => {
        const { tree, codes } = recover('y = x @ color:\nz = 1');
        assert.equal(tree, '(statement (= y x) (@ color:_))\n(= z 1)');
        assert.deepEqual(codes, ['expected-value']);
        const property = parse('y = x @ color:').file.statements[0];
        assert.ok(property.kind === 'ExpressionStatement');
        assert.equal(property.metadata!.entries[0].colon, true);
    });

    test('a missing value inside a block', () => {
        const { tree, codes } = recover('config {\n  xmin:\n  xmax: 2\n}');
        assert.equal(tree, '(config xmin:_ xmax:2)');
        assert.deepEqual(codes, ['expected-value']);
    });

    test('a missing colon', () => {
        const { tree, codes } = recover('y = x @ color RED, hidden');
        assert.equal(tree, '(statement (= y x) (@ color hidden))');
        assert.deepEqual(codes, ['expected-colon']);
    });

    test('a missing property after a comma', () => {
        const { codes } = recover('y = x @ hidden,\nz = 1');
        assert.deepEqual(codes, ['expected-property']);
        assert.equal(recover('y = x @ hidden,\nz = 1').tree.split('\n')[1], '(= z 1)');
    });

    test('a block entry that is not a property', () => {
        const { tree, codes } = recover('config {\n  1 + 2\n  showGrid: true\n}');
        assert.equal(tree, '(config showGrid:true)');
        assert.deepEqual(codes, ['expected-property']);
    });

    test('metadata on a line of its own is misplaced', () => {
        const { tree, codes } = recover('folder "W" {\n  @ collapsed\n  y = x\n}');
        assert.equal(tree, '(folder "W" (error-statement) (= y x))');
        assert.deepEqual(codes, ['misplaced-metadata']);
    });

    test('a misplaced @{ block is skipped whole', () => {
        const { tree, codes } = recover('@{\n  color: RED\n}\ny = x');
        assert.equal(tree, '(error-statement)\n(= y x)');
        assert.deepEqual(codes, ['misplaced-metadata']);
    });

    test('statement keywords missing what they need', () => {
        assert.deepEqual(recover('import\ny = x'), {
            tree: '(error-statement)\n(= y x)',
            codes: ['expected-string'],
        });
        assert.deepEqual(recover('image 3\ny = x'), {
            tree: '(error-statement)\n(= y x)',
            codes: ['expected-string'],
        });
        assert.deepEqual(recover('config\ny = x'), {
            tree: '(error-statement)\n(= y x)',
            codes: ['expected-block'],
        });
        assert.deepEqual(recover('macro = 1\ny = x'), {
            tree: '(error-statement)\n(= y x)',
            codes: ['expected-identifier'],
        });
        assert.deepEqual(recover('macro f(x) x\ny = x'), {
            tree: '(error-statement)\n(= y x)',
            codes: ['expected-equals'],
        });
        assert.deepEqual(recover('ticker\ny = x'), {
            tree: '(ticker (error))\n(= y x)',
            codes: ['expected-expression'],
        });
        assert.deepEqual(recover('import "a" as\ny = x'), {
            tree: '(import "a")\n(= y x)',
            codes: ['expected-string'],
        });
    });

    test('a style with no name keeps its block', () => {
        const { tree, codes } = recover('style { color: RED }\ny = x');
        assert.equal(tree, '(style  color:RED)\n(= y x)');
        assert.deepEqual(codes, ['expected-identifier']);
    });

    test('a with that binds nothing', () => {
        // Reported once: the leftover `3` is where the binding should have been.
        const { tree, codes } = recover('y = x with 3');
        assert.equal(tree, '(= y (with x))\n(error-statement)');
        assert.deepEqual(codes, ['expected-binding']);
    });

    test('lexer errors surface once, not again from the parser', () => {
        const { tree, codes } = recover('y = #ff00 + x\nz = "abc\nw = 1 $ 2');
        assert.equal(tree, '(= y (+ (error) x))\n(= z "abc")\n(= w 1)\n(error-statement)');
        assert.deepEqual(codes, ['invalid-color', 'unterminated-string', 'unexpected-character']);
    });

    test('a keyword where an expression should be', () => {
        const { tree, codes } = recover('y = step\nz = 1');
        assert.equal(tree, '(= y (error))\n(error-statement)\n(= z 1)');
        assert.deepEqual(codes, ['expected-expression']);
    });

    test('.. outside a property is unexpected', () => {
        const { codes } = recover('y = 0..1');
        assert.deepEqual(codes, ['unexpected-token']);
    });

    test('an index takes one expression', () => {
        const { codes } = recover('y = L[1, 2]');
        assert.deepEqual(codes, ['unexpected-token']);
    });

    test('diagnostics are errors with spans and stable codes, in source order', () => {
        const { diagnostics } = parse('y = )\nz = (\nw = #12');
        assert.ok(diagnostics.every(d => d.severity === 'error'));
        const starts = diagnostics.map(d => d.span.start);
        assert.deepEqual(
            starts,
            [...starts].sort((a, b) => a - b),
        );
        assert.ok(diagnostics.every(d => /^[a-z]+(-[a-z]+)*$/.test(d.code)));
    });

    test('never throws, whatever it is given', () => {
        const alphabet = [
            'a',
            'x',
            '1',
            '.5',
            '"s"',
            '#fff',
            '#zz',
            '(',
            ')',
            '[',
            ']',
            '{',
            '}',
            '@',
            '@{',
            ',',
            ';',
            ':',
            '..',
            '...',
            '->',
            '=',
            '<',
            '+',
            '-',
            '*',
            '/',
            '^',
            '!',
            '|',
            '\n',
            ' ',
            'folder',
            'table',
            'config',
            'style',
            'macro',
            'import',
            'image',
            'ticker',
            'with',
            'for',
            'step',
            'soft',
            'as',
            'min',
            '"',
            '$',
        ];
        let seed = 11;
        for (let round = 0; round < 300; round++) {
            let source = '';
            for (let i = 0; i < 60; i++) {
                seed = (seed * 1103515245 + 12345) % 2 ** 31;
                source += alphabet[seed % alphabet.length] + (seed % 3 === 0 ? ' ' : '');
            }
            const result = parse(source);
            assert.equal(result.tokens.map(token => token.text).join(''), source);
            for (const statement of result.file.statements) {
                assert.ok(statement.span.start >= 0 && statement.span.end <= source.length);
                assert.ok(statement.span.start <= statement.span.end);
            }
        }
    });
});
