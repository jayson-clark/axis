import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    compileAxis,
    createImageResolver,
    createImportResolver,
    findImageFiles,
    loadImages,
} from '../dist/index.js';
import type { GraphImage } from '@axis-dsl/desmos';

/** Posix-ish resolution, relative to the file that wrote the path. */
const resolve = (target: string, from: string): string => {
    const segments = [...from.split('/').slice(0, -1), ...target.split('/')];
    const path: string[] = [];

    for (const segment of segments) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') path.pop();
        else path.push(segment);
    }

    return `/${path.join('/')}`;
};

const ENTRY = '/main.axis';

/** The three bytes 1, 2, 3 - `AQID` in base64, which is short enough to read. */
const BYTES = new Uint8Array([1, 2, 3]);

/** An image host serving `files`, and remembering what was asked of it. */
function hostFor(files: Record<string, Uint8Array>, read: string[] = []) {
    return {
        read,
        host: {
            resolve,
            read: async (path: string) => {
                read.push(path);
                const bytes = files[path];
                if (!bytes) {
                    throw new Error('no such file');
                }
                return bytes;
            },
        },
    };
}

/** Compile `script` as `/main.axis`, with `files` on disk beside it. */
async function compile(
    script: string,
    files: Record<string, Uint8Array> = {},
    imports: Record<string, string> = {},
) {
    const { host } = hostFor(files);
    const sources = new Map(Object.entries(imports));
    const images = await loadImages({ path: ENTRY, source: script }, sources, host);

    return compileAxis(script, {
        path: ENTRY,
        resolveImport: createImportResolver(sources, (specifier, from) =>
            resolve(specifier.endsWith('.axis') ? specifier : `${specifier}.axis`, from),
        ),
        resolveImage: createImageResolver(images, host.resolve),
    });
}

const imageIn = (result: { expressions: unknown[] }) =>
    result.expressions.find(
        (expression): expression is GraphImage => (expression as GraphImage).type === 'image',
    )!;

describe('images from a file', () => {
    test('inlines the file as a data URI', async () => {
        const result = await compile('image "./beach.png"', { '/beach.png': BYTES });

        assert.equal(imageIn(result).image_url, 'data:image/png;base64,AQID');
        assert.deepEqual(result.images, ['/beach.png']);
    });

    test('takes its media type from the extension', async () => {
        const jpeg = await compile('image "./a.JPG"', { '/a.JPG': BYTES });
        const svg = await compile('image "./a.svg"', { '/a.svg': BYTES });

        assert.match(imageIn(jpeg).image_url!, /^data:image\/jpeg;base64,/);
        assert.match(imageIn(svg).image_url!, /^data:image\/svg\+xml;base64,/);
    });

    test('encodes bytes the way base64 does, padding and all', async () => {
        const encoded = async (...bytes: number[]) => {
            const result = await compile('image "./a.png"', {
                '/a.png': new Uint8Array(bytes),
            });
            return imageIn(result).image_url!.split(',')[1];
        };

        assert.equal(await encoded(...[...'Man'].map(c => c.charCodeAt(0))), 'TWFu');
        assert.equal(await encoded(...[...'Ma'].map(c => c.charCodeAt(0))), 'TWE=');
        assert.equal(await encoded(...[...'M'].map(c => c.charCodeAt(0))), 'TQ==');
        // The high bit is where a string-shaped encoder goes wrong.
        assert.equal(await encoded(255, 254, 253), '//79');
    });

    test('places it exactly as a URL is placed', async () => {
        const result = await compile('image "./beach.png" # center: (1, 2), width: 4', {
            '/beach.png': BYTES,
        });
        const image = imageIn(result);

        assert.equal(image.center, '\\left(1,2\\right)');
        assert.equal(image.width, '4');
    });

    test('leaves a URL Desmos can load alone', async () => {
        for (const url of [
            'https://example.com/a.png',
            'http://example.com/a.png',
            '//example.com/a.png',
            'data:image/png;base64,AQID',
        ]) {
            const result = await compile(`image "${url}"`);
            assert.equal(imageIn(result).image_url, url);
            assert.deepEqual(result.images, []);
        }
    });

    test('reads an image an imported file draws, relative to that file', async () => {
        const result = await compile(
            'import "./lib/marks.axis"',
            { '/lib/mark.png': BYTES },
            { '/lib/marks.axis': 'image "./mark.png"' },
        );

        assert.equal(imageIn(result).image_url, 'data:image/png;base64,AQID');
        assert.deepEqual(result.images, ['/lib/mark.png']);
    });

    test('reads a file drawn twice once', async () => {
        const { host, read } = hostFor({ '/a.png': BYTES });
        const source = 'image "./a.png"\nimage "./a.png"';
        const images = await loadImages({ path: ENTRY, source }, new Map(), host);

        assert.deepEqual(read, ['/a.png']);
        assert.equal(images.size, 1);
    });

    test('says which file it could not read', async () => {
        const { host } = hostFor({});
        await assert.rejects(
            loadImages({ path: ENTRY, source: 'image "./gone.png"' }, new Map(), host),
            /Cannot read image "\.\/gone\.png", drawn by \/main\.axis/,
        );
    });

    test('will not read a file that is not an image', async () => {
        const { host } = hostFor({ '/notes.txt': BYTES });
        await assert.rejects(
            loadImages({ path: ENTRY, source: 'image "./notes.txt"' }, new Map(), host),
            /is not an image file/,
        );
    });

    test('fails rather than pointing Desmos at a path it cannot fetch', () => {
        assert.throws(
            () => compileAxis('image "./beach.png"', { path: ENTRY }),
            /Cannot resolve image "\.\/beach\.png" from \/main\.axis/,
        );
    });

    test('reports a malformed image statement', () => {
        assert.throws(() => compileAxis("image 'a.png'"), /is not a valid image/);
    });

    test('leaves a variable that happens to be called image alone', () => {
        const { expressions } = compileAxis('image = 5');
        assert.equal(expressions.length, 1);
        assert.equal(expressions[0].type, 'expression');
    });

    test('finds the files a script draws, wherever they are written', () => {
        assert.deepEqual(
            findImageFiles(
                'image "./a.png"\nfolder "F" { image "./b.png" }\nimage "https://example.com/c.png"',
            ),
            ['./a.png', './b.png'],
        );
    });
});
