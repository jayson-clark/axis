// ═════════════════════════════════════════════════════════════════════════════
// The checker - every semantic diagnostic, by its code
// ═════════════════════════════════════════════════════════════════════════════
//
// Spec §8 and §4.6. Each rule is a case that must report exactly its code and
// nothing else, beside a case that must report nothing - so a rule that fires
// too eagerly fails here as surely as one that never fires.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { codes, compileAxis } from './support/compile.mts';

/** `source` reports exactly `expected`, in order. */
function reports(source: string, ...expected: string[]): void {
    assert.deepEqual(codes(source), expected, source);
}

/** `source` reports nothing. */
function clean(source: string): void {
    reports(source);
}

describe('names', () => {
    test('a call on a name that is no function is an error', () => {
        reports('y = notAFunction(x, 1)', 'unknown-function');
        reports('y = sine(x)', 'unknown-function');
        reports('y = foo()', 'unknown-function');
    });

    test('a builtin, a function the file defines, anywhere in it, is a call', () => {
        clean('y = sin(x) + mean([1, 2]) + random()');
        clean('y = f(x)\nf(x) = x ^ 2');
        clean('area(w, h) = w * h\na = area(2, 3)');
    });

    test('a name Desmos reads as a value, with one argument, is a product', () => {
        clean('y = a(x + 1)');
        clean('y = k_1(x - 1)');
        clean('amp = 2\ny = amp(x + 1)');
        clean('y = pi(2)');
        clean('f(amp) = amp(2)');
    });

    test('but not with more than one', () => {
        reports('y = a(1, 2)', 'unknown-function');
        reports('amp = 2\ny = amp(1, 2)', 'unknown-function');
        reports('f(g) = g(1, 2)', 'unknown-function');
    });

    test('says which call it was, and where', () => {
        const [diagnostic] = compileAxis('y = 2 + sine(x)').diagnostics;
        assert.deepEqual(diagnostic.span, { start: 8, end: 12 });
        assert.match(diagnostic.message, /`sine` is not a function/);
    });

    test('an undefined variable is not an error - Desmos offers it as a slider', () => {
        clean('y = m x + b');
    });

    test('assigning to a builtin is an error', () => {
        reports('mean = 3', 'assign-to-builtin');
        reports('sin(x) = x', 'assign-to-builtin');
        reports('pi = 3', 'assign-to-builtin');
        reports('e = 2', 'assign-to-builtin');
        reports('width = 2', 'assign-to-builtin');
    });

    test('a Greek letter is a letter, and theta is polar', () => {
        clean('alpha = 2');
        clean('r = theta');
        clean('theta = 1');
    });

    test('a name has one subscript', () => {
        reports('x_1_2 = 3', 'multiple-subscripts');
        reports('y = a_1_b + 1', 'multiple-subscripts');
        clean('x_12 = 3');
        // Enum values are written with more than one, and are not names.
        clean('a = 1 @ slider: 0..1, playing, loopMode: LOOP_FORWARD_REVERSE');
    });

    test('Desmos has no booleans', () => {
        reports('a = true', 'boolean-in-expression');
        reports('y = x + false', 'boolean-in-expression');
        clean('y = x @ hidden: true');
    });

    test('dt exists only in the ticker’s handler', () => {
        reports('a = dt', 'dt-outside-ticker');
        reports('go = n -> n + dt', 'dt-outside-ticker');
        clean('ticker n -> n + dt');
        clean('macro STEP = n -> n + dt\nticker STEP');
    });

    test('a string is not a value', () => {
        reports('y = "text"', 'unexpected-string');
    });
});

describe('properties', () => {
    test('one that does not exist', () => {
        reports('y = x @ bogus: 1', 'unknown-property');
        reports('config { bogus: 1 }', 'unknown-property');
    });

    test('one in the wrong place, saying where it goes', () => {
        reports('y = x @ collapsed', 'misplaced-property');
        reports('folder "F" { @ color: RED\n y = x }', 'misplaced-property');
        reports('"note" @ hidden', 'misplaced-property');
        reports('ticker a -> 1 @ color: RED', 'misplaced-property');
        reports('import "x" @ color: RED', 'unresolved-import', 'misplaced-property');
        reports('image "https://a/b.png" @ lineWidth: 2', 'misplaced-property');
        reports('table { x = [1] @ label: "a" }', 'misplaced-property');
        reports('config { color: RED }', 'misplaced-property');
        reports('y = x @ minStep: 2', 'misplaced-property');

        const [diagnostic] = compileAxis('y = x @ collapsed').diagnostics;
        assert.match(diagnostic.message, /a folder or an import/);
    });

    test('`playing` is a slider’s on an expression and the ticker’s on a ticker', () => {
        clean('a = 1 @ playing');
        clean('ticker a -> 1 @ playing');
    });

    test('one given twice', () => {
        reports('y = x @ color: RED, color: BLUE', 'duplicate-property');
        clean('style a { color: RED }\nstyle b { lineWidth: 2 }\ny = x @ use: a, use: b');
    });

    test('a value of the wrong type', () => {
        reports('y = x @ lineWidth: "2"', 'invalid-value');
        reports('y = x @ hidden: 1', 'invalid-value');
        reports('(1, 2) @ label: hello', 'invalid-value');
        reports('config { xmin: a }', 'invalid-value');
        reports('config { showGrid: yes }', 'invalid-value');
        reports('a = 1 @ playDirection: x', 'invalid-value');
        reports('(1, 2) @ onClick: 3', 'invalid-value');
        reports('a = 1 @ slider: 3', 'invalid-value');
        reports('y = x @ lineWidth', 'invalid-value');
    });

    test('a number may be negated', () => {
        clean('config { xmin: -3 }');
        clean('a = 1 @ playDirection: -1');
    });

    test('an enum value that is not one', () => {
        reports('y = x @ lineStyle: wavy', 'invalid-enum');
        clean('y = x @ lineStyle: dashed, dragMode: none');
    });

    test('a range where none is allowed', () => {
        reports('y = x @ lineWidth: 0..3', 'unexpected-range');
        clean('a = 1 @ slider: 0..3');
        clean('(cos(t), sin(t)) @ domain: 0..pi');
    });

    test('a domain has no step, and nothing soft', () => {
        reports('(cos(t), sin(t)) @ domain: 0..1 step 2', 'invalid-value');
        reports('(cos(t), sin(t)) @ domain: 0..1 soft', 'invalid-value');
    });

    test('names inside a value are checked like any expression', () => {
        reports('y = x @ lineWidth: sine(2)', 'unknown-function');
        reports('a = 1 @ slider: 0..dt', 'dt-outside-ticker');
    });
});

describe('colours', () => {
    test('a hex literal, a palette name, or an expression', () => {
        clean('y = x @ color: #c74440');
        clean('y = x @ color: RED');
        clean('y = x @ color: rgb(1, 2, 3)');
        clean('warm = rgb(1, 2, 3)\ny = x @ color: warm');
    });

    test('a palette name in the wrong case is not a colour', () => {
        reports('y = x @ color: red', 'invalid-color');
        // Unless the file defines it.
        clean('red = rgb(255, 0, 0)\ny = x @ color: red');
    });

    test('a number or a string is not a colour', () => {
        reports('y = x @ color: 3', 'invalid-color');
        reports('y = x @ color: "red"', 'invalid-color');
    });

    test('the config colours take a hex literal or a palette name only', () => {
        clean('config { backgroundColor: #fff; textColor: BLACK }');
        reports('config { backgroundColor: rgb(1, 2, 3) }', 'invalid-color');
    });
});

describe('placement', () => {
    test('config, ticker, style and macro only at the top level', () => {
        reports('folder "F" { config { showGrid } }', 'misplaced-config');
        reports('folder "F" { ticker a -> 1 }', 'misplaced-ticker');
        reports('folder "F" { style s { color: RED } }', 'misplaced-style');
        reports('folder "F" { macro M = 1 }', 'misplaced-macro');
    });

    test('folders do not nest', () => {
        reports('folder "A" { folder "B" { y = x } }', 'nested-folder');
    });

    test('a file has one config and one ticker', () => {
        reports('config { showGrid }\nconfig { trace }', 'duplicate-config');
        reports('ticker a -> 1\nticker b -> 1', 'duplicate-ticker');
    });

    test('an imported file may have its own config and ticker', () => {
        const result = compileAxis('config { trace }\nticker a -> 1\nimport "lib"', {
            resolveImport: () => ({ path: 'lib', source: 'config { trace }\nticker b -> 1' }),
        });
        assert.deepEqual(result.diagnostics, []);
    });

    test('a table column is values or a computation, not an equation', () => {
        reports('table { x = 5 }', 'invalid-column');
        clean('table { x = [1, 2]; x ^ 2 }');
    });
});

describe('macros', () => {
    test('a use must match the definition', () => {
        reports('macro W(k) = sin(k x)\ny = W(1, 2)', 'macro-arity');
        reports('macro W(k) = sin(k x)\ny = W', 'macro-arity');
        reports('macro TAU = 6.28\ny = TAU(2)', 'macro-arity');
        clean('macro F() = 1\ny = F()');
    });

    test('a macro may not use itself, directly or round a loop', () => {
        reports('macro A = A + 1', 'macro-recursion');
        reports('macro A = B\nmacro B = A', 'macro-recursion', 'macro-recursion');
        clean('macro A = B + 1\nmacro B = 2\ny = A');
    });

    test('a name is defined once', () => {
        reports('macro A = 1\nmacro A = 1', 'duplicate-macro');
    });

    test('a macro shadows nothing', () => {
        reports('macro sin = 3', 'macro-collision');
        reports('macro amp = 3\namp = 2', 'macro-collision');
        reports('macro f = 3\nf(x) = x', 'macro-collision');
    });

    test('and one named after a builtin leaves the builtin alone', () => {
        const result = compileAxis('macro sin = 3\ny = sin(x)');
        assert.deepEqual(
            result.diagnostics.map(d => d.code),
            ['macro-collision'],
        );
        assert.equal(
            (result.state.expressions?.list?.[0] as { latex?: string }).latex,
            'y=\\sin\\left(x\\right)',
        );
    });

    test('a macro’s body is checked once, where it is written', () => {
        const [diagnostic] = compileAxis('macro M = nope(1, 2)\ny = M\ny = M').diagnostics;
        assert.equal(diagnostic.code, 'unknown-function');
        assert.equal(diagnostic.span.start, 10);
        assert.equal(compileAxis('macro M = nope(1, 2)\ny = M\ny = M').diagnostics.length, 1);
    });

    test('a parameter is a name in the body', () => {
        clean('macro APPLY(g, v) = g(v)\nf(x) = x\ny = APPLY(f, 2)');
    });
});

describe('styles', () => {
    test('`use:` names a style that exists', () => {
        reports('y = x @ use: nope', 'unknown-style');
        clean('y = x @ use: s\nstyle s { color: RED }');
    });

    test('a style may not use itself, directly or round a loop', () => {
        reports('style a { use: a }', 'style-cycle');
        reports('style a { use: b }\nstyle b { use: a }', 'style-cycle');
    });

    test('a style is defined once', () => {
        reports('style a { color: RED }\nstyle a { color: BLUE }', 'duplicate-style');
    });

    test('what a style sets must go where it is used', () => {
        reports('style s { showLabel }\ntable { x = [1] @ use: s }', 'misplaced-property');
        clean('style s { showLabel }\n(1, 2) @ use: s');
    });

    test('a style holds anything an expression or a column takes', () => {
        clean('style knob { slider: -3..3 step 0.1; playing }\na = 1 @ use: knob');
        reports('style s { collapsed }', 'misplaced-property');
    });
});

describe('diagnostics', () => {
    test('carry a path only for an imported file', () => {
        const result = compileAxis('y = nope(1, 2)\nimport "lib"', {
            path: 'main',
            resolveImport: () => ({ path: 'lib', source: 'y = nope(1, 2)' }),
        });
        assert.deepEqual(
            result.diagnostics.map(diagnostic => diagnostic.path),
            [undefined, 'lib'],
        );
    });

    test('include the parser’s, in source order', () => {
        const result = compileAxis('y = (\ny = nope(1, 2)');
        assert.deepEqual(
            result.diagnostics.map(diagnostic => diagnostic.code),
            ['unclosed-bracket', 'expected-expression', 'unknown-function'],
        );
    });

    test('are all errors, with a span inside the source', () => {
        const source = 'y = x @ color: red, bogus\nmean = 1';
        for (const diagnostic of compileAxis(source).diagnostics) {
            assert.equal(diagnostic.severity, 'error');
            assert.ok(diagnostic.span.start >= 0 && diagnostic.span.end <= source.length);
        }
    });
});
