// Everything the extension contributes but does not itself contain.
//
// `contributes` paths are resolved against the extension folder, and VSCode
// warns - then a packaged .vsix breaks - if one points outside it. Reaching
// across to ../language and ../viewer works only inside this monorepo, so each
// asset is copied in at build time and the manifest names the copy.
//
// Targets must not collide with anything `tsc` emits from src/, which shares
// dist/ and would otherwise overwrite them on the next build.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = join(extensionRoot, '..');

/** [source, target-in-dist] — the targets are the paths in package.json. */
const assets = [
    // The preview page's UI, built as a single esbuild bundle.
    [join(packages, 'viewer', 'dist', 'preview.js'), 'viewer.js'],
    [join(packages, 'language', 'syntaxes', 'axis.tmLanguage.json'), 'axis.tmLanguage.json'],
    [
        join(packages, 'language', 'src', 'language-configuration.json'),
        'language-configuration.json',
    ],
];

await mkdir(join(extensionRoot, 'dist'), { recursive: true });
await Promise.all(
    assets.map(([source, name]) => copyFile(source, join(extensionRoot, 'dist', name))),
);
