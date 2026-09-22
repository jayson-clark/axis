import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AXIS_CONFIG_PROPERTY_NAMES,
    AXIS_FUNCTION_NAMES,
    AXIS_PALETTE,
    findProperty,
    lineIndex,
    parse,
    propertiesFor,
} from '@axis-dsl/syntax';
import { analyze, getCompletions } from '../dist/index.js';
import { cursor, examples, textOf } from './support.mts';

/** The labels offered at the `|` in `marked`. */
const labels = (marked: string) => {
    const { source, position } = cursor(marked);
    return getCompletions(source, position).map(item => item.label);
};

const has = (offered: string[], ...expected: string[]) => {
    for (const name of expected)
        assert.ok(offered.includes(name), `expected ${name} in ${offered.join(', ')}`);
};
const lacks = (offered: string[], ...unexpected: string[]) => {
    for (const name of unexpected) assert.ok(!offered.includes(name), `did not expect ${name}`);
};

/** Exactly the property names legal in one place. */
const legal = (placement: Parameters<typeof propertiesFor>[0]) =>
    propertiesFor(placement)
        .map(property => property.name)
        .sort();

describe('completions at the start of a statement', () => {
    test('offers every statement keyword at the top level, and the builtins', () => {
        const offered = labels('|');
        has(offered, 'folder', 'table', 'config', 'style', 'macro', 'import', 'image', 'ticker');
        has(offered, 'sin', 'pi', 'width');
    });

    test('offers only what may stand in a folder inside one', () => {
        const offered = labels('folder "A" {\n    |\n}');
        has(offered, 'table', 'import', 'image', 'sin');
        // Folders do not nest, and config, style, macro and ticker are top level only.
        lacks(offered, 'folder', 'config', 'style', 'macro', 'ticker');
    });

    test('offers no keyword among the columns of a table', () => {
        const offered = labels('table {\n    |\n}');
        lacks(offered, 'folder', 'table', 'config', 'import');
        has(offered, 'sin');
    });

    test('gives each keyword a snippet of the whole statement, in v2 syntax', () => {
        const { source, position } = cursor('|');
        const items = getCompletions(source, position);
        const ticker = items.find(item => item.label === 'ticker')!;
        assert.equal(ticker.kind, 'keyword');
        assert.match(ticker.snippet!, /@ minStep/);
        assert.ok(items.find(item => item.label === 'macro')!.snippet!.includes('='));
    });

    test('offers nothing inside a comment or a note', () => {
        assert.deepEqual(labels('// a comment |'), []);
        assert.deepEqual(labels('"a note |'), []);
    });

    test('offers nothing where a name is being given', () => {
        assert.deepEqual(labels('style |'), []);
        assert.deepEqual(labels('macro |'), []);
        assert.deepEqual(labels('folder |'), []);
    });
});

describe('completions of names', () => {
    test('offers the names the document itself defines', () => {
        has(labels('f(x) = x^2\nk = 3\n|'), 'f', 'k');
    });

    test('offers each name once', () => {
        const offered = labels('f(x) = x\nf(x) = x\n|');
        assert.equal(new Set(offered).size, offered.length);
    });

    test('offers a name defined below the cursor, since definitions are hoisted', () => {
        has(labels('y = |\namp = 3'), 'amp');
    });

    test('offers a definition inside a folder everywhere', () => {
        has(labels('folder "F" { depth = 2 }\ny = |'), 'depth');
    });

    test('offers a table column that names a list', () => {
        has(labels('table { x_1 = [1, 2]; y_1 = [3, 4] }\n|'), 'x_1', 'y_1');
    });

    test('gives a user function a snippet of its parameters, and its definition as detail', () => {
        const { source, position } = cursor('f(a, b) = a + b\ny = |');
        const f = getCompletions(source, position).find(item => item.label === 'f')!;
        assert.equal(f.kind, 'function');
        assert.equal(f.snippet, 'f(${1:a}, ${2:b})');
        assert.equal(f.detail, 'f(a, b) = a + b');
    });

    test('offers macros, and a parameterised one as a call', () => {
        const { source, position } = cursor('macro TAU2 = 2tau\nmacro wave(k) = sin(k x)\ny = |');
        const items = getCompletions(source, position);
        const tau = items.find(item => item.label === 'TAU2')!;
        const wave = items.find(item => item.label === 'wave')!;
        assert.equal(tau.kind, 'macro');
        assert.equal(tau.snippet, undefined);
        assert.equal(wave.snippet, 'wave(${1:k})');
    });

    test('offers the parameters of the function being written', () => {
        const offered = labels('f(amp, freq) = amp * sin(|');
        has(offered, 'amp', 'freq');
        // And first: they are what is most likely meant.
        assert.deepEqual(offered.slice(0, 2), ['amp', 'freq']);
    });

    test('offers the parameters of a macro being written', () => {
        has(labels('macro lerp(from, to, t) = from + (to - from) * |'), 'from', 'to', 't');
    });

    test('offers a parameter only inside its own definition', () => {
        const offered = labels('f(amp) = amp\ny = |');
        lacks(offered, 'amp');
    });

    test('offers a with or for binding inside what it binds for', () => {
        has(labels('y = n x with n = 3 + 0 |'), 'n');
        has(labels('L = [i ^ 2 + | for i = [1...10]]'), 'i');
    });

    test('offers dt only in a ticker handler', () => {
        has(labels('n = 0\nticker n -> n + |'), 'dt');
        lacks(labels('n = 0\ny = n + |'), 'dt');
        // Not in the ticker's metadata either: that is properties.
        lacks(labels('ticker n -> n + 1 @ |'), 'dt');
    });

    test('offers every builtin function, constant and operator in an expression', () => {
        const offered = labels('y = |');
        has(offered, ...AXIS_FUNCTION_NAMES, 'pi', 'tau', 'e', 'infinity', 'width', 'index');
    });

    test('offers coordinates and list functions after a dot', () => {
        const offered = labels('P = (1, 2)\nL = [1, 2]\ny = P.|');
        has(offered, 'x', 'y', 'mean', 'count', 'total');
        lacks(offered, 'sin', 'folder');
    });

    test('replaces the word being typed, and only the part before the cursor', () => {
        const { source, position } = cursor('y = si|n');
        const item = getCompletions(source, position).find(item => item.label === 'sin')!;
        assert.equal(textOf(source, item.range!), 'si');
    });

    test('ranks what the file defines ahead of the builtins', () => {
        const offered = labels('zeta2 = 1\ny = |');
        assert.ok(offered.indexOf('zeta2') < offered.indexOf('sin'));
    });
});

describe('completions in metadata', () => {
    test('offers exactly the properties an expression takes after `@`', () => {
        assert.deepEqual(labels('y = x @ |').sort(), legal('expression'));
        assert.deepEqual(labels('y = x @|').sort(), legal('expression'));
    });

    test('offers the properties of each statement kind', () => {
        assert.deepEqual(labels('ticker n -> n + 1 @ |').sort(), legal('ticker'));
        assert.deepEqual(labels('image "./a.png" @ |').sort(), legal('image'));
        assert.deepEqual(labels('import "./a" @ |').sort(), legal('import'));
        assert.deepEqual(labels('"A note" @ |').sort(), legal('note'));
    });

    test('offers a folder its own properties straight after its `{`', () => {
        assert.deepEqual(labels('folder "A" { @ |').sort(), legal('folder'));
        // ... and an expression's to a statement inside it.
        assert.deepEqual(labels('folder "A" {\n    y = x @ |\n}').sort(), legal('expression'));
    });

    test('offers a table its column defaults, and a column its own', () => {
        assert.deepEqual(labels('table { @ |').sort(), legal('table'));
        assert.deepEqual(labels('table {\n    x_1 = [1, 2] @ |\n}').sort(), legal('column'));
    });

    test('offers the next property after a comma, leaving out those already given', () => {
        const offered = labels('y = x @ color: RED, lineWidth: 2, |');
        lacks(offered, 'color', 'lineWidth');
        has(offered, 'lineStyle', 'hidden');
    });

    test('keeps `use` on offer, since it may be repeated', () => {
        has(labels('y = x @ use: a, |'), 'use');
    });

    test('offers properties after a bare flag and its comma', () => {
        const offered = labels('y = x @ hidden, |');
        lacks(offered, 'hidden');
        has(offered, 'color');
    });

    test('offers properties again after an action run the comma rule ended', () => {
        has(labels('(1, 2) @ onClick: a -> 1, b -> 2, |'), 'color');
    });

    test('offers properties while one is being typed', () => {
        const { source, position } = cursor('y = x @ color: RED, line|');
        const items = getCompletions(source, position);
        assert.ok(items.some(item => item.label === 'lineWidth'));
        assert.equal(textOf(source, items[0].range!), 'line');
    });

    test('offers properties in a `@{ … }` block, a line at a time', () => {
        const offered = labels('y = x @{\n    color: RED\n    |\n}');
        lacks(offered, 'color', 'sin');
        has(offered, 'lineWidth');
    });

    test('offers a ticker its own properties in a `@{ … }` block', () => {
        assert.deepEqual(labels('ticker n -> n + 1 @{\n    |\n}').sort(), legal('ticker'));
    });

    test('gives each property its snippet and documentation', () => {
        const { source, position } = cursor('y = x @ |');
        const lineStyle = getCompletions(source, position).find(
            item => item.label === 'lineStyle',
        )!;
        assert.equal(lineStyle.kind, 'property');
        assert.equal(lineStyle.snippet, findProperty('lineStyle')!.snippet);
        assert.match(lineStyle.documentation!, /SOLID/);
    });

    test('offers a statement nothing after its metadata closes', () => {
        assert.deepEqual(labels('y = x @{ color: RED } |'), []);
    });

    test('leaves metadata at the end of the line', () => {
        has(labels('y = x @ color: RED\n|'), 'folder', 'sin');
    });
});

describe('completions of property values', () => {
    test('offers an enum its values', () => {
        assert.deepEqual(labels('y = x @ lineStyle: |'), ['DASHED', 'DOTTED', 'SOLID']);
        assert.deepEqual(labels('y = x @ color: RED, dragMode: |').sort(), [
            'AUTO',
            'NONE',
            'X',
            'XY',
            'Y',
        ]);
    });

    test('offers a colour the palette first, then any expression', () => {
        const { source, position } = cursor('y = x @ color: |');
        const items = getCompletions(source, position);
        assert.deepEqual(
            items
                .slice(0, AXIS_PALETTE.length)
                .map(item => item.label)
                .sort(),
            AXIS_PALETTE.map(color => color.name).sort(),
        );
        assert.equal(items[0].kind, 'color');
        assert.ok(items.some(item => item.label === 'rgb'));
    });

    test('offers a config colour only the palette, which is all Desmos takes there', () => {
        assert.deepEqual(
            labels('config { backgroundColor: |').sort(),
            AXIS_PALETTE.map(color => color.name).sort(),
        );
    });

    test('offers a boolean true and false', () => {
        assert.deepEqual(labels('y = x @ points: |').sort(), ['false', 'true']);
        assert.deepEqual(labels('config {\n    showGrid: |\n}').sort(), ['false', 'true']);
    });

    test('offers `use:` the styles the file defines, wherever they are written', () => {
        const offered = labels(
            'y = x @ use: |\nstyle hot { color: RED }\nstyle cold { color: BLUE }',
        );
        assert.deepEqual(offered.sort(), ['cold', 'hot']);
    });

    test('offers `use:` in a style block and in a `@{ … }` block', () => {
        assert.deepEqual(labels('style a { color: RED }\nstyle b { use: | }'), ['a', 'b']);
        assert.deepEqual(labels('style a { color: RED }\ny = x @{\n    use: |\n}'), ['a']);
    });

    test('offers an expression property the names and builtins', () => {
        has(labels('w = 3\ny = x @ lineWidth: |'), 'w', 'sin');
    });

    test('offers a range its keywords as well as expressions', () => {
        has(labels('a = 1 @ slider: 0..10 |'), 'step', 'soft', 'sin');
    });

    test('offers a string or a number property nothing', () => {
        assert.deepEqual(labels('y = x @ label: |'), []);
        assert.deepEqual(labels('y = x @ animationPeriod: |'), []);
    });
});

describe('completions in config and style blocks', () => {
    test('offers only config properties inside a config block', () => {
        const offered = labels('config {\n    |');
        assert.deepEqual(offered.sort(), [...AXIS_CONFIG_PROPERTY_NAMES].sort());
    });

    test('leaves the config block once it closes', () => {
        has(labels('config {\n}\n|'), 'sin');
    });

    test('offers the next key after a `;` in a one-line block', () => {
        const offered = labels('config { showGrid: false; |');
        lacks(offered, 'showGrid');
        has(offered, 'xmin');
    });

    test('offers a style every property it may hold', () => {
        assert.deepEqual(labels('style s {\n    |\n}').sort(), legal('style'));
    });

    test('offers the next key after a mistaken comma in a block', () => {
        has(labels('config { showGrid: false, |'), 'xmin');
    });
});

describe('completions over the examples', () => {
    // Every property an example writes is one a completion at its key would
    // have offered, and every enum value one its colon would: the context
    // read off the tokens agrees with the placement the tree gives.
    for (const { name, source } of examples) {
        test(`offers what ${name} writes, where it writes it`, () => {
            const tree = parse(source);
            const lines = lineIndex(source);
            for (const occurrence of analyze(tree).occurrences) {
                const { start } = occurrence.identifier.span;
                const position = lines.positionAt(start);
                const here = () => getCompletions(tree, position).map(item => item.label);
                const written = occurrence.identifier.name;
                if (
                    occurrence.role === 'property' &&
                    findProperty(written, occurrence.placement!)
                ) {
                    has(here(), written);
                } else if (occurrence.role === 'enumValue') {
                    has(here(), ...occurrence.property!.values!);
                } else if (
                    occurrence.role === 'palette' ||
                    (occurrence.role === 'styleName' && occurrence.symbol)
                ) {
                    has(here(), written);
                }
            }
        });
    }
});
