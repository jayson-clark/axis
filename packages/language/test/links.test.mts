import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findAxisLinks } from '../dist/index.js';

/** The text a link underlines, which is what a reader clicks. */
const underlined = (source: string) =>
    findAxisLinks(source).map(link =>
        source.split('\n')[link.line].slice(link.startCharacter, link.endCharacter),
    );

describe('document links', () => {
    test('points an import at the file it names', () => {
        const [link, ...rest] = findAxisLinks('y = x\nimport "./lib/curves.axis" as "Curves"');

        assert.deepEqual(rest, []);
        assert.equal(link.kind, 'import');
        assert.equal(link.target, './lib/curves.axis');
        assert.deepEqual([link.line, link.startCharacter, link.endCharacter], [1, 8, 25]);
    });

    test('points an image at the file it draws', () => {
        const [link] = findAxisLinks('image "./images/wave.png" # width: 4');

        assert.equal(link.kind, 'image');
        assert.equal(link.target, './images/wave.png');
    });

    test('marks an image that names an address as one to open as it is', () => {
        const [link] = findAxisLinks('image "https://example.com/a.png"');

        assert.equal(link.kind, 'url');
        assert.equal(link.target, 'https://example.com/a.png');
    });

    test('leaves a data URI alone, since it names nothing to open', () => {
        assert.deepEqual(findAxisLinks('image "data:image/png;base64,AQID"'), []);
    });

    test('underlines the path itself, without its quotes', () => {
        assert.deepEqual(
            underlined('import "./a.axis"\nimage "./b.png"\nfolder "F" { import "./c.axis" }'),
            ['./a.axis', './b.png', './c.axis'],
        );
    });

    test('reports them in document order, whichever statement wrote them', () => {
        const links = findAxisLinks('image "./a.png"\nimport "./b.axis"\nimage "./c.png"');

        assert.deepEqual(
            links.map(link => [link.line, link.kind]),
            [
                [0, 'image'],
                [1, 'import'],
                [2, 'image'],
            ],
        );
    });

    test('finds nothing in a script that names no files', () => {
        assert.deepEqual(findAxisLinks('y = x\n"an image of a beach"\nimage = 5'), []);
    });
});
