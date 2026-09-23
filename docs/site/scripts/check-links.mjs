#!/usr/bin/env node
// Every link from one page of the built site to another has to arrive: run
// after `astro build`, it reads each page in `dist/` and fails the build on a
// link to a page or file that is not there - a link written relative to the
// wrong place, or one missing the site's base, is exactly that.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const BASE = '/axis/';

function html(directory) {
    return readdirSync(directory).flatMap(name => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return html(path);
        return name.endsWith('.html') ? [path] : [];
    });
}

const broken = [];
for (const page of html(dist)) {
    const url = new URL(
        `${BASE}${relative(dist, page).replace(/index\.html$/, '')}`,
        'https://site.invalid',
    );
    for (const [, href] of readFileSync(page, 'utf8').matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
        if (/^[a-z]+:/i.test(href) || href.startsWith('#')) continue;
        const target = new URL(href.replaceAll('&amp;', '&'), url).pathname;
        const path = target.startsWith(BASE)
            ? join(dist, decodeURI(target.slice(BASE.length)))
            : undefined;
        const found =
            path !== undefined &&
            (existsSync(join(path, 'index.html')) || (existsSync(path) && statSync(path).isFile()));
        if (!found) broken.push(`${relative(dist, page)}: ${href}`);
    }
}

if (broken.length) {
    console.error(
        `${broken.length} broken link${broken.length === 1 ? '' : 's'}:\n  ${broken.join('\n  ')}`,
    );
    process.exit(1);
}
console.log('Every internal link arrives.');
