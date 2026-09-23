// An "Open in playground" link under every `axis` block on the site, added by
// an Expressive Code plugin at build time, so there is no script on the page to
// find the blocks. A block that shows a mistake (`error="…"`) gets none: there
// is nothing to draw.

import { definePlugin } from '@astrojs/starlight/expressive-code';
import { h } from '@astrojs/starlight/expressive-code/hast';
import { encodeSource } from './share';

export function playgroundLink(base: string) {
    const href = `${base.replace(/\/$/, '')}/playground/`;
    return definePlugin({
        name: 'axis-playground-link',
        baseStyles: `
            .axis-playground-link {
                display: block;
                padding: 0.35rem 1rem;
                font-size: 0.8rem;
                text-align: right;
                border-top: 1px solid var(--ec-brdCol);
                text-decoration: none;
            }
            .axis-playground-link:hover { text-decoration: underline; }
        `,
        hooks: {
            postprocessRenderedBlock: ({ codeBlock, renderData }) => {
                if (codeBlock.language !== 'axis' || /\berror=/.test(codeBlock.meta)) return;
                renderData.blockAst.children.push(
                    h(
                        'a.axis-playground-link',
                        { href: href + encodeSource(codeBlock.code) },
                        'Open in playground →',
                    ),
                );
            },
        },
    });
}
