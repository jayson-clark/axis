#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════
// Everything the site takes from the rest of the repo, put where Astro reads it
// ═════════════════════════════════════════════════════════════════════════════
//
// Runs before `astro dev` and `astro build`. Nothing it writes is committed
// (see `.gitignore`): the spec stays in `docs/spec.md`, the logo in `assets/`,
// and the reference in the packages it is generated from.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referencePages } from './reference.mjs';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(site, '..');
const docs = join(site, 'src/content/docs');

const REPO = 'https://github.com/jayson-clark/axis/blob/main';

function write(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
}

// The logo and the favicon, from the one set of generated assets.
mkdirSync(join(site, 'src/assets'), { recursive: true });
copyFileSync(join(root, 'assets/axis-mark.svg'), join(site, 'src/assets/axis-mark.svg'));
copyFileSync(join(root, 'assets/axis-tile.svg'), join(site, 'public/favicon.svg'));

// The specification, as written. Its title becomes the page's, and a link
// into the repo - `../packages/syntax/src/ast.ts` - points at GitHub instead.
{
    const spec = readFileSync(join(root, 'docs/spec.md'), 'utf8');
    const [heading, ...rest] = spec.split('\n');
    const title = heading.replace(/^#\s+/, '');
    const body = rest.join('\n').replace(/\]\(\.\.\/([^)]+)\)/g, (_, path) => `](${REPO}/${path})`);
    write(
        join(docs, 'spec.md'),
        `---\ntitle: ${JSON.stringify(title)}\ndescription: The Axis language, as the compiler and every editor service read it.\neditUrl: ${REPO.replace('/blob/', '/edit/')}/docs/spec.md\n---\n${body}`,
    );
}

// The reference, out of the manifest and the diagnostic catalogues.
for (const [path, text] of Object.entries(referencePages())) {
    write(join(docs, 'reference', path), text);
}
