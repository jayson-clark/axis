import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type ExpressionStatement, type Property } from '../dist/index.js';
import { recover, tree } from './support.mts';

/** The properties trailing a lone statement. */
const entries = (source: string): Property[] => {
    const { file, diagnostics } = parse(source);
    assert.deepEqual(diagnostics, []);
    return (file.statements[0] as ExpressionStatement).metadata!.entries;
};

describe('inline metadata (spec §4.1)', () => {
    test('key: value pairs, separated by commas', () => {
        assert.equal(
            tree('y = x @ color: RED, lineWidth: 4'),
            '(statement (= y x) (@ color:RED lineWidth:4))',
        );
    });

    test('bare flags mean true, and may be mixed with values', () => {
        assert.equal(tree('y = x @ hidden, fill'), '(statement (= y x) (@ hidden fill))');
        assert.equal(
            tree('y = x @ hidden, color: RED, fill'),
            '(statement (= y x) (@ hidden color:RED fill))',
        );
    });

    test('a flag has no colon and no value', () => {
        const [flag] = entries('y = x @ hidden');
        assert.equal(flag.colon, false);
        assert.equal(flag.value, null);
        assert.equal(flag.key.name, 'hidden');
    });

    test('the comma rule: a comma belongs to the value unless a property follows it', () => {
        assert.equal(
            tree('(1, 2) @ onClick: a -> 1, b -> 2, color: RED'),
            '(statement (tuple 1 2) (@ onClick:(run (-> a 1) (-> b 2)) color:RED))',
        );
    });

    test('the comma rule: a bare identifier ending the clause is a flag', () => {
        assert.equal(
            tree('(1, 2) @ onClick: a -> 1, hidden'),
            '(statement (tuple 1 2) (@ onClick:(-> a 1) hidden))',
        );
        assert.equal(
            tree('(1, 2) @ onClick: a -> 1, hidden, fill'),
            '(statement (tuple 1 2) (@ onClick:(-> a 1) hidden fill))',
        );
        // Also before a `;`, and before the `}` closing the enclosing block.
        assert.equal(
            tree('P = (1, 2) @ onClick: A, hidden; Q = 1'),
            '(statement (= P (tuple 1 2)) (@ onClick:A hidden))\n(= Q 1)',
        );
        assert.equal(
            tree('folder { P = (1, 2) @ onClick: A, hidden }'),
            '(folder _ (statement (= P (tuple 1 2)) (@ onClick:A hidden)))',
        );
    });

    test('the comma rule: an identifier followed by more is part of the value', () => {
        assert.equal(
            tree('P = (1, 2) @ onClick: A, B -> 1'),
            '(statement (= P (tuple 1 2)) (@ onClick:(run A (-> B 1))))',
        );
    });

    test('the comma rule holds for with bindings too', () => {
        assert.equal(
            tree('y = x @ lineWidth: w with w = 2, v = 3, hidden'),
            '(statement (= y x) (@ lineWidth:(with w (w 2) (v 3)) hidden))',
        );
    });

    test('commas inside brackets always belong to the bracket', () => {
        assert.equal(
            tree('y = x @ color: rgb(1, 2, 3), hidden'),
            '(statement (= y x) (@ color:(call rgb 1 2 3) hidden))',
        );
        assert.equal(
            tree('image "a.png" @ center: (0, 1), width: 10'),
            '(image "a.png" (@ center:(tuple 0 1) width:10))',
        );
    });

    test('metadata values are any expression', () => {
        assert.equal(
            tree('y = x @ lineWidth: a + 1, label: "hi", color: #c74440'),
            '(statement (= y x) (@ lineWidth:(+ a 1) label:"hi" color:#c74440))',
        );
    });
});

describe('block metadata', () => {
    test('@{ … } takes properties separated by newlines or ;', () => {
        assert.equal(
            tree('y = x @{\n  color: RED\n  hidden; lineWidth: 2\n}'),
            '(statement (= y x) (@{} color:RED hidden lineWidth:2))',
        );
        assert.equal(tree('y = x @{ hidden }'), '(statement (= y x) (@{} hidden))');
        assert.equal(tree('y = x @{}'), '(statement (= y x) (@{}))');
    });

    test('inside a block a comma is always the value', () => {
        assert.equal(
            tree('P = (1, 2) @{\n  onClick: a -> 1, b -> 2\n}'),
            '(statement (= P (tuple 1 2)) (@{} onClick:(run (-> a 1) (-> b 2))))',
        );
        // Even before a lone identifier, which inline would have been a flag.
        assert.equal(
            tree('P = (1, 2) @{ onClick: A, B }'),
            '(statement (= P (tuple 1 2)) (@{} onClick:(run A B)))',
        );
    });

    test('a comma between block entries is reported, and read as a separator', () => {
        const { tree: shape, codes } = recover('config { showGrid: true, xmin: 1 }');
        assert.equal(shape, '(config showGrid:true xmin:1)');
        assert.deepEqual(codes, ['comma-between-properties']);
    });

    test('the block flag is set', () => {
        const { file } = parse('a = 1 @{ hidden }\nb = 1 @ hidden');
        const [block, inline] = file.statements as ExpressionStatement[];
        assert.equal(block.metadata!.block, true);
        assert.equal(inline.metadata!.block, false);
    });
});

describe('ranges (spec §4.4)', () => {
    const range = (value: string) => {
        const shape = tree(`a = 1 @ slider: ${value}`);
        return shape.slice('(statement (= a 1) (@ slider:'.length, -2);
    };

    test('both ends', () => assert.equal(range('-5..5'), '(range (- 5) 5)'));
    test('with a step', () => assert.equal(range('-5..5 step 0.5'), '(range (- 5) 5 step 0.5)'));
    test('open at the top', () => assert.equal(range('0..'), '(range 0 _)'));
    test('open at the bottom', () => assert.equal(range('..5'), '(range _ 5)'));
    test('open at both', () => assert.equal(range('..'), '(range _ _)'));
    test('open with a step', () => assert.equal(range('0.. step 2'), '(range 0 _ step 2)'));
    test('soft', () => assert.equal(range('0.. soft'), '(range 0 _ soft)'));
    test('soft min', () => assert.equal(range('0..1 soft min'), '(range 0 1 soft-min)'));
    test('soft max', () =>
        assert.equal(range('0..2pi soft max'), '(range 0 (implicit 2 pi) soft-max)'));
    test('step and soft', () =>
        assert.equal(range('0..10 step 1 soft'), '(range 0 10 step 1 soft)'));
    test('any expression at either end and in the step', () =>
        assert.equal(range('-a..a step a / 10'), '(range (- a) a step (/ a 10))'));

    test('a range is followed by more properties', () => {
        assert.equal(
            tree('t = 0 @ slider: 0..2pi soft max, playing'),
            '(statement (= t 0) (@ slider:(range 0 (implicit 2 pi) soft-max) playing))',
        );
    });

    test('ranges in a block', () => {
        assert.equal(
            tree('(cos(t), sin(t)) @{\n  domain: 0..tau\n}'),
            '(statement (tuple (call cos t) (call sin t)) (@{} domain:(range 0 tau)))',
        );
    });

    test('the soft end is recorded', () => {
        const soft = (value: string) => {
            const [property] = entries(`a = 1 @ slider: ${value}`);
            return property.value?.kind === 'Range' ? property.value.soft : undefined;
        };
        assert.equal(soft('0..1'), 'none');
        assert.equal(soft('0..1 soft'), 'both');
        assert.equal(soft('0..1 soft min'), 'min');
        assert.equal(soft('0..1 soft max'), 'max');
    });

    test('min and max are only words after soft', () => {
        assert.equal(range('min..max'), '(range min max)');
    });
});
