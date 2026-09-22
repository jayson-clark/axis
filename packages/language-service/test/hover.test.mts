import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getHover } from '../dist/index.js';
import { positionOf, textOf } from './support.mts';
import { resolveFrom } from './imports.mts';

/** The hover over the `n`th `needle`, a character into it. */
const hover = (source: string, needle: string, n = 0, options = {}) =>
    getHover(source, positionOf(source, needle, n, 1), options);

describe('hover over builtins and the manifest', () => {
    test('describes a builtin function from the manifest', () => {
        const result = hover('y = sin(x)', 'sin')!;
        assert.match(result.contents, /```axis\nsin\(x\)\n```/);
        assert.match(result.contents, /Sine function/);
        assert.equal(textOf('y = sin(x)', result.range), 'sin');
    });

    test('describes a constant and an operator', () => {
        assert.match(hover('y = pi x', 'pi')!.contents, /3\.14159/);
        assert.match(
            hover('ticker n -> n + dt', 'dt')!.contents,
            /Milliseconds since the last tick/,
        );
    });

    test('describes a list function written as a member', () => {
        assert.match(hover('L = [1, 2]\nm = L.mean', 'mean')!.contents, /mean/i);
    });

    test('describes a property, where it is written', () => {
        const contents = hover('y = x @ lineStyle: DASHED', 'lineStyle')!.contents;
        assert.match(contents, /Line style/);
        assert.match(contents, /`SOLID`, `DASHED`, `DOTTED`/);
        assert.match(contents, /Written on/);
    });

    test('describes the ticker’s own `playing`, not a slider’s', () => {
        assert.match(hover('ticker n -> n + 1 @ playing', 'playing')!.contents, /ticker running/);
        assert.match(hover('a = 1 @ playing', 'playing')!.contents, /Animate slider/);
    });

    test('describes an enum value as the property’s', () => {
        const contents = hover('y = x @ lineStyle: dashed', 'dashed')!.contents;
        assert.match(contents, /a value of `lineStyle`/);
    });

    test('describes a palette colour with its hex', () => {
        assert.match(hover('y = x @ color: RED', 'RED')!.contents, /#c74440/);
    });

    test('describes every keyword, and `min` and `max` after `soft`', () => {
        assert.match(hover('folder "A" { }', 'folder')!.contents, /A folder of statements/);
        assert.match(hover('a = 1 @ slider: 0..1 step 0.1', 'step')!.contents, /step/);
        assert.match(hover('a = 1 @ slider: 0..1 soft max', 'max')!.contents, /upper end/);
        // Anywhere else `max` is the list function.
        assert.match(hover('m = max([1, 2])', 'max')!.contents, /```axis\nmax/);
    });

    test('says nothing over punctuation, numbers or a name nothing defines', () => {
        assert.equal(hover('y = 2 + x', '+'), undefined);
        assert.equal(getHover('y = 22', { line: 0, character: 5 }), undefined);
        assert.equal(hover('y = zz', 'zz'), undefined);
    });
});

describe('hover over what the script defines', () => {
    test('prints a variable’s definition, metadata left off', () => {
        const source = 'amp = 3 @ slider: 0..5\ny = amp sin(x)';
        const contents = hover(source, 'amp', 1)!.contents;
        assert.equal(contents, '(variable)\n\n```axis\namp = 3\n```');
    });

    test('prints a function’s definition, formatted', () => {
        const contents = hover('f(x)=x^2+1\ny = f(x)', 'f', 1)!.contents;
        assert.match(contents, /\(function\)/);
        assert.match(contents, /f\(x\) = x \^ 2 \+ 1/);
    });

    test('prints a macro and a style', () => {
        const source =
            'macro wave(k) = sin(k x)\nstyle loud { color: RED }\ny = wave(2) @ use: loud';
        assert.match(hover(source, 'wave', 1)!.contents, /macro wave\(k\) = sin\(k x\)/);
        assert.match(hover(source, 'loud', 1)!.contents, /style loud \{ color: RED \}/);
    });

    test('names a parameter and what it belongs to', () => {
        const contents = hover('f(amp) = 2amp', 'amp', 1)!.contents;
        assert.equal(contents, '(parameter) amp (parameter of f(amp))');
    });

    test('describes the definition itself when hovered there', () => {
        assert.match(hover('k = 3', 'k')!.contents, /k = 3/);
    });

    test('follows a name into the file that defines it, given a resolver', () => {
        const options = {
            path: '/main.axis',
            resolveImport: resolveFrom({
                '/lib/waves.axis': 'wave(x) = sin(2x)\nstyle faint { lineOpacity: 0.3 }',
            }),
        };
        const source = 'import "./lib/waves"\ny = wave(x) @ use: faint';
        const contents = hover(source, 'wave', 1, options)!.contents;
        assert.match(contents, /wave\(x\) = sin\(2x\)/);
        assert.match(contents, /From `\/lib\/waves\.axis`/);
        assert.match(hover(source, 'faint', 0, options)!.contents, /style faint/);
        // Without one, it is a name the file does not know.
        assert.equal(hover(source, 'wave', 1), undefined);
    });
});
