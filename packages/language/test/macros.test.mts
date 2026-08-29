import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    defineMacro,
    expandMacros,
    findMacroDefinitions,
    formatAxisCode,
    getAxisCompletions,
    MacroError,
    parseMacroDefinition,
    validateAxis,
    type AxisDiagnosticCode,
    type MacroDefinition,
} from '../dist/index.js';

const codes = (source: string): AxisDiagnosticCode[] =>
    validateAxis(source).map(diagnostic => diagnostic.code);

/** Expand `line` against the macros `definitions` defines. */
const expand = (definitions: string, line: string): string =>
    expandMacros(line, new Map(findMacroDefinitions(definitions).map(m => [m.name, m])));

const format = (source: string) => formatAxisCode(source, { tabSize: 4, insertSpaces: true });

describe('parseMacroDefinition', () => {
    test('reads an object-like macro as a name and everything after it', () => {
        assert.deepEqual(parseMacroDefinition('macro TAU 6.283185'), {
            name: 'TAU',
            body: '6.283185',
        });
    });

    test('reads a function-like macro as a name, its parameters and its body', () => {
        assert.deepEqual(parseMacroDefinition('macro LERP(a, b, t) a + (b - a) * t'), {
            name: 'LERP',
            parameters: ['a', 'b', 't'],
            body: 'a + (b - a) * t',
        });
    });

    test('takes an empty parameter list as a macro that must be called', () => {
        assert.deepEqual(parseMacroDefinition('macro NOW() t'), {
            name: 'NOW',
            parameters: [],
            body: 't',
        });
    });

    test('needs the bracket to touch the name, so a body may open with one', () => {
        assert.deepEqual(parseMacroDefinition('macro ORIGIN (0, 0)'), {
            name: 'ORIGIN',
            body: '(0, 0)',
        });
    });

    test('is not a definition when `macro` names a variable', () => {
        assert.equal(parseMacroDefinition('macro = 3'), undefined);
        assert.equal(parseMacroDefinition('macroscopic = 3'), undefined);
        assert.equal(parseMacroDefinition('y = x^2'), undefined);
    });

    test('refuses a definition it cannot read', () => {
        assert.throws(() => parseMacroDefinition('macro F'), MacroError);
        assert.throws(() => parseMacroDefinition('macro F(a'), MacroError);
        assert.throws(() => parseMacroDefinition('macro F(1) x'), MacroError);
        assert.throws(() => parseMacroDefinition('macro F(a, a) a'), MacroError);
    });
});

describe('findMacroDefinitions', () => {
    test('finds every definition, wherever the layout puts it', () => {
        const source = [
            '// a comment',
            'macro TAU 6.28',
            'y = TAU',
            'macro LERP(',
            '    a, b, t',
            ') a + (b - a) * t',
        ].join('\n');

        assert.deepEqual(
            findMacroDefinitions(source).map(macro => macro.name),
            ['TAU', 'LERP'],
        );
    });

    test('skips a definition that does not parse, which is left to be reported', () => {
        assert.deepEqual(findMacroDefinitions('macro F\nmacro G 1'), [{ name: 'G', body: '1' }]);
    });
});

describe('defineMacro', () => {
    const table = () => new Map<string, MacroDefinition>();

    test('accepts the same definition twice, as two imports of one file give', () => {
        const macros = table();
        defineMacro(macros, { name: 'TAU', body: '6.28' });
        defineMacro(macros, { name: 'TAU', body: '6.28' });
        assert.equal(macros.size, 1);
    });

    test('refuses two definitions that disagree', () => {
        const macros = table();
        defineMacro(macros, { name: 'TAU', body: '6.28' });
        assert.throws(() => defineMacro(macros, { name: 'TAU', body: '6.29' }), MacroError);
    });
});

describe('expandMacros', () => {
    test('substitutes an object-like macro wherever its name appears', () => {
        assert.equal(expand('macro TAU 6.28', 'y = sin(TAU * x)'), 'y = sin(6.28 * x)');
    });

    test('substitutes a call, argument by argument', () => {
        assert.equal(
            expand('macro LERP(a, b, t) a + (b - a) * t', 'y = LERP(0, 10, x)'),
            'y = 0 + (10 - 0) * x',
        );
    });

    test('brackets an argument so the body binds the way it reads', () => {
        assert.equal(expand('macro HALF(x) x / 2', 'y = HALF(a + b)'), 'y = (a + b) / 2');
    });

    test('brackets an expansion against whatever it lands next to', () => {
        assert.equal(expand('macro D(x) 2 * x', 'y = D(x) ^ 2'), 'y = (2 * x) ^ 2');
        assert.equal(expand('macro D(x) 2 * x', 'y = 3D(x)'), 'y = 3(2 * x)');
    });

    test('leaves the brackets off where nothing could bind across them', () => {
        assert.equal(expand('macro D(x) 2 * x', 'y = D(x)'), 'y = 2 * x');
        assert.equal(expand('macro D(x) 2 * x', 'P = [D(1), D(2)]'), 'P = [2 * 1, 2 * 2]');
    });

    test('brackets a bare number rather than run it into the one beside it', () => {
        assert.equal(expand('macro TAU 6.28', 'y = 2TAU'), 'y = 2(6.28)');
    });

    test('leaves a run of properties unbracketed, being no kind of expression', () => {
        assert.equal(expand('macro S color: blue', '(0, 0) # S'), '(0, 0) # color: blue');
        assert.equal(expand('macro S #{color: blue}', '(0, 0) S'), '(0, 0) # color: blue');
        assert.equal(expand('macro S {color: blue}', '(0, 0) #S'), '(0, 0) #{color: blue}');
    });

    test('splices in anything brackets would re-read, as it was written', () => {
        assert.equal(expand('macro P(a, b) (a, b)', 'Q = P(1, 2)'), 'Q = (1, 2)');
        assert.equal(expand('macro STEP(v) v -> v + 1', 'ticker STEP(a)'), 'ticker a -> a + 1');
        assert.equal(expand('macro CURVE y = x^2', 'CURVE'), 'y = x^2');
    });

    test('expands a macro used inside another macro', () => {
        assert.equal(
            expand('macro G(x) x^2\nmacro H(x) G(x) + G(2 * x)', 'y = H(3)'),
            'y = 3^2 + (2 * 3)^2',
        );
    });

    test('stops rather than expand a macro inside its own expansion', () => {
        assert.equal(expand('macro A B\nmacro B A', 'y = A'), 'y = A');
        assert.equal(expand('macro R R + 1', 'y = R'), 'y = R + 1');
    });

    test('expands a function-like macro only where it is called', () => {
        assert.equal(expand('macro F(a) a * 2', 'y = F + F(3)'), 'y = F + 3 * 2');
    });

    test('leaves a name that is only part of a longer one alone', () => {
        assert.equal(expand('macro TAU 6.28', 'y = xTAU + TAUx'), 'y = xTAU + TAUx');
    });

    test('leaves strings and comments as the text they are', () => {
        assert.equal(
            expand('macro TAU 6.28', '"TAU is a macro" // and TAU is its name'),
            '"TAU is a macro" // and TAU is its name',
        );
    });

    test('refuses a call with the wrong number of arguments', () => {
        assert.throws(() => expand('macro F(a) a', 'y = F(1, 2)'), MacroError);
    });

    test('leaves a line alone when there are no macros at all', () => {
        assert.equal(expandMacros('y = x^2', new Map()), 'y = x^2');
    });
});

describe('macro diagnostics', () => {
    test('reports a definition it cannot read', () => {
        assert.deepEqual(codes('macro F'), ['macro-syntax']);
        assert.deepEqual(codes('macro F(a, a) a'), ['macro-syntax']);
    });

    test('reports a macro written inside a block', () => {
        assert.deepEqual(codes('folder "A" {\n    macro F 1\n}'), ['macro-placement']);
    });

    test('reports two definitions of one name that disagree, and only those', () => {
        assert.deepEqual(codes('macro F 1\nmacro F 2'), ['duplicate-macro']);
        assert.deepEqual(codes('macro F 1\nmacro F 1'), []);
    });

    test('reports a call the definition cannot take', () => {
        const [diagnostic, ...rest] = validateAxis('macro F(a) a\ny = F(1, 2)');
        assert.deepEqual(rest, []);
        assert.equal(diagnostic.code, 'macro-arity');
        assert.equal(diagnostic.line, 1);
    });

    test('reads a definition whose body is a metadata block', () => {
        assert.deepEqual(codes('macro STYLE #{color: blue}\n(0, 0) STYLE'), []);
        assert.deepEqual(codes('folder "A" {\n    macro S #{color: blue}\n}'), ['macro-placement']);
    });

    test('holds the properties in such a body to the rules every property has', () => {
        assert.deepEqual(codes('macro STYLE #{colour: blue}'), ['unknown-metadata-property']);
    });

    test('says nothing about a script whose macros are used properly', () => {
        assert.deepEqual(codes('macro TAU 6.28\nmacro LERP(a, b, t) a + (b - a) * t\ny = TAU'), []);
    });
});

describe('formatting a macro', () => {
    test('spaces the body as the statement it will become', () => {
        assert.equal(format('macro LERP(a,b,t) a+(b-a)*t'), 'macro LERP(a, b, t) a + (b - a) * t');
    });

    test('spaces a metadata body as the run of properties it is', () => {
        assert.equal(format('macro S #{color:blue}'), 'macro S # color: blue');
        assert.equal(format('macro S #color:blue'), 'macro S # color: blue');
        assert.equal(format('macro S {color:blue}'), 'macro S {color: blue}');
    });

    test('leaves a metadata body that the wrapping spread over lines alone', () => {
        const wrapped = 'macro S #{\n    color: blue\n    pointSize: 20\n}';
        assert.equal(format(wrapped), wrapped);
    });

    test('leaves a definition being typed exactly as it is', () => {
        assert.equal(format('macro F(a'), 'macro F(a');
    });

    test('is a script the formatter leaves alone the second time', () => {
        const once = format('macro D(x)   2*x\ny=D(3)');
        assert.equal(format(once), once);
    });
});

describe('macro completions', () => {
    test('offers the macros the document defines', () => {
        const source = 'macro TAU 6.28\nmacro LERP(a, b, t) a + (b - a) * t\n';
        const items = getAxisCompletions(source, { line: 2, character: 0 });

        const tau = items.find(item => item.label === 'TAU');
        assert.equal(tau?.kind, 'constant');
        assert.equal(tau?.detail, 'Macro: 6.28');

        const lerp = items.find(item => item.label === 'LERP');
        assert.equal(lerp?.kind, 'function');
        assert.equal(lerp?.snippet, 'LERP(${1:a}, ${2:b}, ${3:t})');
    });

    test('offers the keyword itself', () => {
        const items = getAxisCompletions('', { line: 0, character: 0 });
        assert.equal(items.find(item => item.label === 'macro')?.kind, 'keyword');
    });
});
