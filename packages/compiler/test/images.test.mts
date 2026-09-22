// ═════════════════════════════════════════════════════════════════════════════
// Images from a file - read ahead of time, inlined as a data URI
// ═════════════════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { GraphImage } from '@axis-dsl/desmos';
import {
    createImageResolver,
    createImportResolver,
    findImageFiles,
    loadImages,
} from '../dist/index.js';
import {
    compileAxis,
    ENTRY,
    resolvePath,
    withExtension,
    type CompilationResult,
} from './support/compile.mts';

/** The three bytes 1, 2, 3 - `AQID` in base64, which is short enough to read. */
const BYTES = new Uint8Array([1, 2, 3]);

/** An image host serving `files`, and remembering what was asked of it. */
function hostFor(files: Record<string, Uint8Array>, read: string[] = []) {
    return {
        read,
        host: {
            resolve: resolvePath,
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

/** Compile `script` as `/main.axis`, with pictures and scripts on disk beside it. */
async function compile(
    script: string,
    files: Record<string, Uint8Array> = {},
    imports: Record<string, string> = {},
): Promise<CompilationResult> {
    const { host } = hostFor(files);
    const sources = new Map(Object.entries(imports));
    const images = await loadImages({ path: ENTRY, source: script }, sources, host);

    return compileAxis(script, {
        path: ENTRY,
        resolveImport: createImportResolver(sources, (specifier, from) =>
            resolvePath(withExtension(specifier), from),
        ),
        resolveImage: createImageResolver(images, host.resolve),
    });
}

const imageIn = (result: CompilationResult) =>
    (result.state.expressions?.list ?? []).find(
        (item): item is GraphImage => item.type === 'image',
    )!;

describe('images from a file', () => {
    test('inline the file as a data URI', async () => {
        const result = await compile('image "./beach.png"', { '/beach.png': BYTES });

        assert.equal(imageIn(result).image_url, 'data:image/png;base64,AQID');
        assert.deepEqual(result.dependencies.images, ['/beach.png']);
        assert.deepEqual(result.diagnostics, []);
    });

    test('take their media type from the extension', async () => {
        const jpeg = await compile('image "./a.JPG"', { '/a.JPG': BYTES });
        const svg = await compile('image "./a.svg"', { '/a.svg': BYTES });

        assert.match(imageIn(jpeg).image_url!, /^data:image\/jpeg;base64,/);
        assert.match(imageIn(svg).image_url!, /^data:image\/svg\+xml;base64,/);
    });

    test('encode bytes the way base64 does, padding and all', async () => {
        const encoded = async (...bytes: number[]) => {
            const result = await compile('image "./a.png"', { '/a.png': new Uint8Array(bytes) });
            return imageIn(result).image_url!.split(',')[1];
        };

        assert.equal(await encoded(...[...'Man'].map(c => c.charCodeAt(0))), 'TWFu');
        assert.equal(await encoded(...[...'Ma'].map(c => c.charCodeAt(0))), 'TWE=');
        assert.equal(await encoded(...[...'M'].map(c => c.charCodeAt(0))), 'TQ==');
        // The high bit is where a string-shaped encoder goes wrong.
        assert.equal(await encoded(255, 254, 253), '//79');
    });

    test('are placed exactly as a URL is placed', async () => {
        const result = await compile('image "./beach.png" @ center: (1, 2), width: 4', {
            '/beach.png': BYTES,
        });
        assert.equal(imageIn(result).center, '\\left(1,2\\right)');
        assert.equal(imageIn(result).width, '4');
    });

    test('leave a URL Desmos can load alone', async () => {
        for (const url of [
            'https://example.com/a.png',
            'http://example.com/a.png',
            '//example.com/a.png',
            'data:image/png;base64,AQID',
        ]) {
            const result = await compile(`image "${url}"`);
            assert.equal(imageIn(result).image_url, url);
            assert.deepEqual(result.dependencies.images, []);
        }
    });

    test('are read relative to the imported file that draws them', async () => {
        const result = await compile(
            'import "./lib/marks"',
            { '/lib/mark.png': BYTES },
            { '/lib/marks.axis': 'image "./mark.png"' },
        );

        assert.equal(imageIn(result).image_url, 'data:image/png;base64,AQID');
        assert.deepEqual(result.dependencies.images, ['/lib/mark.png']);
    });

    test('are read once however often they are drawn', async () => {
        const { host, read } = hostFor({ '/a.png': BYTES });
        const source = 'image "./a.png"\nimage "./a.png"';
        const images = await loadImages({ path: ENTRY, source }, new Map(), host);

        assert.deepEqual(read, ['/a.png']);
        assert.equal(images.size, 1);
    });
});

describe('an image that goes wrong', () => {
    test('is a diagnostic against the statement when it cannot be read', async () => {
        const result = await compile('y = x\nimage "./gone.png"');
        const [diagnostic] = result.diagnostics;

        assert.equal(diagnostic.code, 'unresolved-image');
        assert.match(diagnostic.message, /Cannot resolve image "\.\/gone\.png" from \/main\.axis/);
        assert.equal(imageIn(result), undefined);
        assert.equal((result.state.expressions?.list ?? []).length, 1);
    });

    test('is a diagnostic when it is not a picture', async () => {
        const { host } = hostFor({ '/notes.txt': BYTES });
        const images = await loadImages(
            { path: ENTRY, source: 'image "./notes.txt"' },
            new Map(),
            host,
        );
        assert.equal(images.size, 0);

        const result = await compile('image "./notes.txt"', { '/notes.txt': BYTES });
        assert.equal(result.diagnostics[0].code, 'invalid-image');
    });

    test('is never pointed at a path Desmos cannot fetch', () => {
        const result = compileAxis('image "./beach.png"', { path: ENTRY });
        assert.equal(result.diagnostics[0].code, 'unresolved-image');
        assert.equal(imageIn(result), undefined);
    });

    test('leaves a variable that happens to be called image alone', () => {
        // `image` is a keyword now, so the name is not one a script can use;
        // what matters is that the compiler says so rather than throwing.
        assert.doesNotThrow(() => compileAxis('image = 5'));
    });
});

describe('finding image files', () => {
    test('finds the files a script draws, wherever they are written', () => {
        assert.deepEqual(
            findImageFiles(
                'image "./a.png"\nfolder "F" { image "./b.png" }\nimage "https://example.com/c.png"',
            ),
            ['./a.png', './b.png'],
        );
    });
});
