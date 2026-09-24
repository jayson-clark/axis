import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AXIS_BUILTIN_NAMES,
    AXIS_MANIFEST,
    AXIS_PALETTE,
    AXIS_PALETTE_HEX,
    AXIS_PROPERTIES,
    AXIS_PROPERTY_NAMES,
    AXIS_PROPERTY_PLACEMENTS,
    KEYWORDS,
    enumValue,
    findProperty,
    placementsOf,
    propertiesFor,
} from '../dist/index.js';

const VALUE_TYPES = [
    'expression',
    'number',
    'string',
    'boolean',
    'enum',
    'color',
    'range',
    'action',
    'style',
    'name',
];

describe('manifest properties', () => {
    test('every property has a known value type and at least one placement', () => {
        for (const property of AXIS_PROPERTIES) {
            assert.ok(VALUE_TYPES.includes(property.valueType), property.name);
            assert.ok(property.appliesTo.length > 0, property.name);
            for (const placement of property.appliesTo) {
                assert.ok(AXIS_PROPERTY_PLACEMENTS.includes(placement), property.name);
            }
        }
    });

    test('enum properties list their values, and nothing else does', () => {
        for (const property of AXIS_PROPERTIES) {
            if (property.valueType === 'enum') {
                assert.ok(property.values && property.values.length > 0, property.name);
                // Every value must be writable as an identifier.
                for (const value of property.values!) {
                    assert.match(value, /^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/, value);
                }
            } else {
                assert.equal(property.values, undefined, property.name);
            }
        }
    });

    test('no name is defined twice for one placement', () => {
        for (const placement of AXIS_PROPERTY_PLACEMENTS) {
            const names = AXIS_PROPERTIES.filter(p => p.appliesTo.includes(placement)).map(
                p => p.name,
            );
            assert.deepEqual(names, [...new Set(names)], placement);
        }
    });

    test('the v1 names are gone', () => {
        for (const name of ['sliderBounds', 'colorLatex']) {
            assert.equal(AXIS_PROPERTY_NAMES.has(name), false, name);
        }
    });

    test('the value types spec §4 names', () => {
        const typeOf = (name: string, placement?: Parameters<typeof findProperty>[1]) =>
            findProperty(name, placement)?.valueType;
        assert.equal(typeOf('slider'), 'range');
        assert.equal(typeOf('domain'), 'range');
        assert.equal(typeOf('parametricDomain'), 'range');
        assert.equal(typeOf('polarDomain'), 'range');
        assert.equal(typeOf('onClick'), 'action');
        assert.equal(typeOf('color'), 'color');
        assert.equal(typeOf('use'), 'style');
        assert.equal(typeOf('lineWidth'), 'expression');
        assert.equal(typeOf('hidden'), 'boolean');
        assert.equal(typeOf('label'), 'string');
        assert.equal(typeOf('lineStyle'), 'enum');
        assert.equal(typeOf('xmin', 'config'), 'number');
        assert.equal(typeOf('backgroundColor', 'config'), 'color');
        assert.equal(typeOf('minStep', 'ticker'), 'expression');
    });

    test('use is the only repeatable property', () => {
        assert.deepEqual(
            AXIS_PROPERTIES.filter(p => p.repeatable).map(p => p.name),
            ['use'],
        );
    });
});

describe('placement', () => {
    const names = (placement: Parameters<typeof propertiesFor>[0]) =>
        propertiesFor(placement).map(p => p.name);

    test('folders and imports', () => {
        assert.deepEqual(names('folder'), ['hidden', 'secret', 'collapsed']);
        assert.deepEqual(names('import'), ['hidden', 'secret', 'collapsed']);
    });

    test('tickers take only their own', () => {
        assert.deepEqual(names('ticker'), ['minStep', 'playing', 'open']);
    });

    test('config takes only its own, and nothing else takes those', () => {
        assert.deepEqual(
            names('config'),
            AXIS_MANIFEST.configProperties.map(p => p.name),
        );
        for (const property of AXIS_MANIFEST.configProperties) {
            assert.deepEqual(property.appliesTo, ['config'], property.name);
        }
    });

    test('images', () => {
        const image = names('image');
        for (const name of [
            'name',
            'center',
            'width',
            'height',
            'angle',
            'opacity',
            'foreground',
            'onClick',
        ]) {
            assert.ok(image.includes(name), name);
        }
        assert.ok(!image.includes('lineWidth'));
    });

    test('a style carries exactly what an expression or a column may', () => {
        // Except a name: a regression's residuals are one list, and a style
        // shared by two regressions would name it twice.
        const either = new Set(
            [...names('expression'), ...names('column')].filter(
                name => findProperty(name)?.valueType !== 'name',
            ),
        );
        assert.deepEqual(new Set(names('style')), either);
        assert.ok(either.has('slider'));
    });

    test('a table carries exactly what a column may, as defaults for every column', () => {
        assert.deepEqual(new Set(names('table')), new Set(names('column')));
    });

    test('playing means one thing on an expression and another on a ticker', () => {
        assert.notEqual(findProperty('playing', 'expression'), findProperty('playing', 'ticker'));
        assert.deepEqual(placementsOf('playing'), ['expression', 'ticker', 'style']);
        assert.equal(findProperty('collapsed', 'expression'), undefined);
        assert.deepEqual(placementsOf('collapsed'), ['folder', 'import']);
        assert.deepEqual(placementsOf('notAProperty'), []);
    });
});

describe('enums', () => {
    test('Desmos spellings: upper case for styles and modes, lower for orientations', () => {
        assert.deepEqual(findProperty('dragMode')?.values, ['AUTO', 'X', 'Y', 'XY', 'NONE']);
        assert.deepEqual(findProperty('lineStyle')?.values, ['SOLID', 'DASHED', 'DOTTED']);
        assert.ok(findProperty('labelOrientation')?.values?.includes('above_left'));
    });

    test('are matched without regard to case', () => {
        const dragMode = findProperty('dragMode')!;
        const orientation = findProperty('labelOrientation')!;
        assert.equal(enumValue(dragMode, 'none'), 'NONE');
        assert.equal(enumValue(dragMode, 'Xy'), 'XY');
        assert.equal(enumValue(orientation, 'ABOVE'), 'above');
        assert.equal(enumValue(dragMode, 'sideways'), undefined);
        assert.equal(enumValue(findProperty('hidden')!, 'true'), undefined);
    });
});

describe('names', () => {
    test('the palette, with Desmos hex values', () => {
        assert.deepEqual(
            AXIS_PALETTE.map(color => color.name),
            ['RED', 'BLUE', 'GREEN', 'PURPLE', 'ORANGE', 'BLACK'],
        );
        assert.equal(AXIS_PALETTE_HEX.get('RED'), '#c74440');
        assert.equal(AXIS_PALETTE_HEX.get('BLUE'), '#2d70b3');
        assert.equal(AXIS_PALETTE_HEX.get('GREEN'), '#388c46');
        assert.equal(AXIS_PALETTE_HEX.get('PURPLE'), '#6042a6');
        assert.equal(AXIS_PALETTE_HEX.get('ORANGE'), '#fa7e19');
        assert.equal(AXIS_PALETTE_HEX.get('BLACK'), '#000000');
    });

    test('dt is a known name', () => {
        assert.ok(AXIS_BUILTIN_NAMES.has('dt'));
    });

    test('the manifest keywords are the lexer keywords', () => {
        assert.deepEqual(AXIS_MANIFEST.keywords, [...KEYWORDS]);
    });

    test('no builtin is a keyword', () => {
        // `for` and `with` are the exception that proves it: they are
        // operators Desmos writes, and keywords Axis reads.
        const clashes = [...AXIS_BUILTIN_NAMES].filter(name =>
            (KEYWORDS as readonly string[]).includes(name),
        );
        assert.deepEqual(clashes.sort(), ['for', 'with']);
    });
});
