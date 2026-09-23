#!/usr/bin/env node
// Every link from one page of the built site to another has to arrive: run
// after `astro build`, it reads each page in `dist/` and fails the build on a
// link to a page or file that is not there - a link written relative to the
// wrong place, or one missing the site's base, is exactly that.
//
// Editors link too: the language service gives every diagnostic a link to its
// code's entry in the reference, and nothing on the site points at those
// anchors to be checked the ordinary way. So each code's link is checked here
// against the built page, and a code renamed, or a page moved, fails the build
// rather than a link in somebody's editor.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTAX_DIAGNOSTICS } from '@axis-dsl/syntax';
import { COMPILER_DIAGNOSTICS } from '@axis-dsl/compiler';
import { diagnosticDocsUrl } from '@axis-dsl/language-service';

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

const codes = new Set([...Object.keys(SYNTAX_DIAGNOSTICS), ...Object.keys(COMPILER_DIAGNOSTICS)]);
for (const code of codes) {
    const href = diagnosticDocsUrl(code);
    const url = href === undefined ? undefined : new URL(href);
    const page =
        url && url.pathname.startsWith(BASE)
            ? join(dist, decodeURI(url.pathname.slice(BASE.length)), 'index.html')
            : undefined;
    const ids =
        page && existsSync(page)
            ? [...readFileSync(page, 'utf8').matchAll(/\bid="([^"]*)"/g)].map(([, id]) => id)
            : [];
    const anchor = url && decodeURIComponent(url.hash.slice(1));
    if (!url || !ids.includes(anchor)) {
        broken.push(`the diagnostic ${code}: ${href ?? 'no link'}`);
    } else if (ids.includes(`${anchor}-1`)) {
        // A second heading for the same code, which the link cannot reach.
        broken.push(`the diagnostic ${code}: two entries, and ${href} finds only the first`);
    }
}

if (broken.length) {
    console.error(
        `${broken.length} broken link${broken.length === 1 ? '' : 's'}:\n  ${broken.join('\n  ')}`,
    );
    process.exit(1);
}
console.log('Every internal link, and every diagnostic code’s link, arrives.');
