// @ts-check
// The Axis documentation site. Everything that can be generated from the
// language is - the reference from the manifest, the diagnostics from their
// catalogues, the specification from `docs/spec.md` - by `scripts/generate.mjs`,
// which runs before `dev` and `build`. What is written here by hand is the
// guide around it.

import { fileURLToPath } from 'node:url';
import { defineConfig, passthroughImageService } from 'astro/config';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { playgroundLink } from './src/components/playground-link.ts';
import grammar from '@axis-dsl/language-service/syntaxes/axis.tmLanguage.json' with { type: 'json' };

const packagesDir = fileURLToPath(new URL('../packages/', import.meta.url));
const base = '/axis';

export default defineConfig({
    site: 'https://jayson-clark.github.io',
    base,
    // Every image is an SVG, which there is nothing to optimise in.
    image: { service: passthroughImageService() },
    integrations: [
        starlight({
            title: 'Axis',
            description: 'A scripting language for Desmos.',
            logo: { src: './src/assets/axis-mark.svg' },
            favicon: '/favicon.svg',
            social: [
                { icon: 'github', label: 'GitHub', href: 'https://github.com/jayson-clark/axis' },
            ],
            editLink: { baseUrl: 'https://github.com/jayson-clark/axis/edit/main/site/' },
            customCss: ['./src/styles/axis.css'],
            expressiveCode: {
                plugins: [playgroundLink(base)],
                // The grammar VSCode colours a script with, so a block on the
                // site reads exactly as it does in the editor.
                shiki: {
                    langs: [{ ...grammar, name: 'axis', aliases: ['Axis'] }],
                    // The spec's grammar blocks; there is no EBNF grammar to colour them.
                    langAlias: { ebnf: 'txt' },
                },
            },
            sidebar: [
                { label: 'Start here', items: [{ autogenerate: { directory: 'start' } }] },
                { label: 'Guide', items: [{ autogenerate: { directory: 'guide' } }] },
                {
                    label: 'Examples',
                    collapsed: true,
                    items: [{ autogenerate: { directory: 'examples' } }],
                },
                { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
                { label: 'Playground', link: '/playground/' },
                { label: 'Specification', link: '/spec/' },
            ],
        }),
        react(),
    ],
    vite: {
        resolve: {
            // Bundle the workspace packages from their TypeScript source, as
            // the playground in `examples/web` does: their built output is
            // CommonJS for Node, and this way there is nothing to rebuild.
            alias: [
                {
                    find: /^@axis-dsl\/([^/]+)\/(monaco)$/,
                    replacement: `${packagesDir}$1/src/$2/index.ts`,
                },
                { find: /^@axis-dsl\/([^/]+)$/, replacement: `${packagesDir}$1/src/index.ts` },
            ],
        },
    },
});
