// A rehype plugin: every relative link in a page's Markdown made absolute.
//
// Pages are written with relative links - `../../reference/properties/` - which
// resolve against the page's URL. That is only right when the URL ends in `/`:
// Starlight serves `/axis/guide/styling` as well, and from there the same link
// leaves the site. So each is resolved here, at build time, against the URL the
// page is really at, and the browser never has to.

import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visit } from 'unist-util-visit';

const pages = fileURLToPath(new URL('../src/content/docs/', import.meta.url));

/** `guide/styling.md` as `/axis/guide/styling/`; `index.mdx` as `/axis/`. */
function pageUrl(base, file) {
    const slug = relative(pages, file)
        .split(sep)
        .join('/')
        .replace(/\.mdx?$/, '')
        .replace(/(^|\/)index$/, '');
    return `${base}/${slug}${slug ? '/' : ''}`;
}

export function absoluteLinks(base) {
    return () => (tree, file) => {
        if (!file.path?.startsWith(pages)) return;
        const here = new URL(pageUrl(base.replace(/\/$/, ''), file.path), 'https://site.invalid');
        visit(tree, 'element', node => {
            const href = node.tagName === 'a' ? node.properties?.href : undefined;
            if (typeof href !== 'string' || /^([a-z]+:|\/|#)/i.test(href)) return;
            const url = new URL(href, here);
            node.properties.href = url.pathname + url.search + url.hash;
        });
    };
}
