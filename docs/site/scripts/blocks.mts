// ═════════════════════════════════════════════════════════════════════════════
// Every `axis` block the docs show that nothing else already checks
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler's and the harness' `docs.test.mts` compile and draw each one.
// The site's generated pages are left out: their examples come from the
// manifest, the diagnostic catalogues and the example scripts, which are
// tested where they are defined. What is here is everything written by hand -
// the site's own pages, the spec, and the keyword documentation hover shows.
//
// A block written to show a mistake says which: ```axis error="unknown-function"
// must raise exactly that code, and is not drawn.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYWORD_INFO } from '@axis-dsl/language-service';

export interface DocBlock {
    /** Where it is written, relative to the repo, with its line. */
    where: string;
    source: string;
    /** The code it is meant to raise, for a block that shows a mistake. */
    error?: string;
}

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PAGES = join(ROOT, 'docs/site/src/content/docs');

/** What `scripts/generate.mjs` writes under the site's pages, and is not written by hand. */
const GENERATED = new Set(['reference', 'examples', 'spec.md']);

/** The `axis` blocks in one Markdown text. */
export function axisBlocks(markdown: string, where: string): DocBlock[] {
    const blocks: DocBlock[] = [];
    const fence = /^([ \t]*)```axis\b([^\n]*)\n([\s\S]*?)^\1```[ \t]*$/gm;
    for (const match of markdown.matchAll(fence)) {
        const line = markdown.slice(0, match.index).split('\n').length;
        const error = /\berror="([a-z-]+)"/.exec(match[2])?.[1];
        const indent = match[1];
        const source = match[3]
            .replace(/\n$/, '')
            .split('\n')
            .map(text => (text.startsWith(indent) ? text.slice(indent.length) : text))
            .join('\n');
        blocks.push({ where: `${where}:${line}`, source, ...(error ? { error } : {}) });
    }
    return blocks;
}

function pages(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (directory === PAGES && GENERATED.has(entry.name)) return [];
        if (entry.isDirectory()) return pages(path);
        return /\.mdx?$/.test(entry.name) ? [path] : [];
    });
}

/** Every hand-written `axis` block: the site's pages, the spec, the keywords' hover. */
export function documentationBlocks(): DocBlock[] {
    const files = [...pages(PAGES), join(ROOT, 'docs/spec.md')];
    return [
        ...files.flatMap(path => axisBlocks(readFileSync(path, 'utf8'), relative(ROOT, path))),
        ...Object.entries(KEYWORD_INFO).flatMap(([keyword, info]) =>
            axisBlocks(info.documentation, `KEYWORD_INFO.${keyword}`),
        ),
    ];
}
