import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getDocumentLinks } from '../dist/index.js';
import { examples, textOf } from './support.mts';

/** The text a link underlines, which is what a reader clicks. */
const underlined = (source: string) =>
    getDocumentLinks(source).map(link => textOf(source, link.range));

describe('document links', () => {
    test('points an import at the file it names', () => {
        const [link, ...rest] = getDocumentLinks('y = x\nimport "./lib/curves.axis" as "Curves"');

        assert.deepEqual(rest, []);
        assert.equal(link.kind, 'import');
        assert.equal(link.target, './lib/curves.axis');
        assert.deepEqual(link.range, {
            start: { line: 1, character: 8 },
            end: { line: 1, character: 25 },
        });
    });

    test('points an image at the file it draws', () => {
        const [link] = getDocumentLinks('image "./images/wave.png" @ width: 4');

        assert.equal(link.kind, 'image');
        assert.equal(link.target, './images/wave.png');
    });

    test('marks an image that names an address as one to open as it is', () => {
        const [link] = getDocumentLinks('image "https://example.com/a.png"');

        assert.equal(link.kind, 'url');
        assert.equal(link.target, 'https://example.com/a.png');
    });

    test('leaves a data URI alone, since it names nothing to open', () => {
        assert.deepEqual(getDocumentLinks('image "data:image/png;base64,AQID"'), []);
    });

    test('underlines the path itself, without its quotes', () => {
        assert.deepEqual(
            underlined('import "./a.axis"\nimage "./b.png"\nfolder "F" { import "./c.axis" }'),
            ['./a.axis', './b.png', './c.axis'],
        );
    });

    test('reads a path with an escape as the path it spells', () => {
        const [link] = getDocumentLinks('import "./a \\"b\\".axis"');
        assert.equal(link.target, './a "b".axis');
    });

    test('reports them in document order, whichever statement wrote them', () => {
        const links = getDocumentLinks('image "./a.png"\nimport "./b.axis"\nimage "./c.png"');

        assert.deepEqual(
            links.map(link => [link.range.start.line, link.kind]),
            [
                [0, 'image'],
                [1, 'import'],
                [2, 'image'],
            ],
        );
    });

    test('finds nothing in a script that names no files', () => {
        assert.deepEqual(getDocumentLinks('y = x\n"an image of a beach"\nimage = 5'), []);
    });

    test('finds every import and image in the examples', () => {
        const imports = examples.find(example => example.name === '16-imports.axis')!;
        assert.deepEqual(underlined(imports.source), ['./lib/waves.axis', './lib/envelope.axis']);
        const images = examples.find(example => example.name === '18-images.axis')!;
        assert.ok(
            getDocumentLinks(images.source).some(link => link.target === './images/wave.png'),
        );
    });
});
