import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AXIS_IMAGE_EXTENSIONS,
    imageMediaType,
    importTitle,
    isImageUrl,
    withAxisExtension,
} from '../dist/index.js';

// Spec §7. Every host resolves a path through these, so they are pinned here
// once rather than in each of them.

describe('what an import names', () => {
    test('implies .axis, and does not add it twice', () => {
        assert.equal(withAxisExtension('./lib/waves'), './lib/waves.axis');
        assert.equal(withAxisExtension('./lib/waves.axis'), './lib/waves.axis');
    });

    test('titles its folder after the file, without its directory or extension', () => {
        assert.equal(importTitle('/work/lib/waves.axis'), 'waves');
        assert.equal(importTitle('file:///work/lib/waves.axis'), 'waves');
        assert.equal(importTitle('C:\\work\\lib\\waves.axis'), 'waves');
        assert.equal(importTitle('waves'), 'waves');
    });
});

describe('what an image names', () => {
    test('tells a URL Desmos can load from a path beside the script', () => {
        assert.equal(isImageUrl('https://example.com/a.png'), true);
        assert.equal(isImageUrl('data:image/png;base64,AQID'), true);
        assert.equal(isImageUrl('//example.com/a.png'), true);
        assert.equal(isImageUrl('./beach.png'), false);
        assert.equal(isImageUrl('/assets/beach.png'), false);
    });

    test('knows what a file holds by its extension, and says nothing about the rest', () => {
        assert.equal(imageMediaType('a/b/beach.PNG'), 'image/png');
        assert.equal(imageMediaType('beach.jpg'), 'image/jpeg');
        assert.equal(imageMediaType('beach.txt'), undefined);
        assert.equal(imageMediaType('beach'), undefined);
    });

    test('lists every extension it knows a media type for', () => {
        for (const extension of AXIS_IMAGE_EXTENSIONS) {
            assert.notEqual(imageMediaType(`a.${extension}`), undefined, extension);
        }
    });
});
