// Builds everything the extension ships into `dist/`:
//
// - `extension.js`, the extension host's entry, and `server.js`, the Axis
//   language server it starts - each one CommonJS file with its dependencies
//   bundled in, so a packaged .vsix needs no node_modules and the host never
//   has to `require` the ES modules some of those dependencies are;
// - the assets `contributes` names: the viewer's page bundle, the TextMate
//   grammar, and the language configuration.
//
// `contributes` paths are resolved against the extension folder, and VSCode
// warns - then a packaged .vsix breaks - if one points outside it. Reaching
// across to ../language-service and ../viewer works only inside this monorepo,
// so each asset is copied in and the manifest names the copy.
//
// `--watch` rebuilds the bundles as their sources change, the dist of every
// workspace package included, which each package's own `watch` keeps fresh.
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(extensionRoot, 'dist');
const require = createRequire(join(extensionRoot, 'package.json'));
const watch = process.argv.includes('--watch');

// A clean folder, so nothing a previous layout left in it - `tsc` used to emit
// here - is packaged by accident.
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// ── Assets ──────────────────────────────────────────────────────────────────

const packages = join(extensionRoot, '..');
await Promise.all([
    // The preview page's UI, built by the viewer as a single esbuild bundle.
    copyFile(join(packages, 'viewer', 'dist', 'preview.js'), join(dist, 'viewer.js')),
    copyFile(
        join(packages, 'language-service', 'syntaxes', 'axis.tmLanguage.json'),
        join(dist, 'axis.tmLanguage.json'),
    ),
]);

// Written from the service's own constants, so VSCode and Monaco are
// configured from one copy. VSCode takes a word pattern as a string.
const { AXIS_LANGUAGE_CONFIGURATION, AXIS_WORD_PATTERN } = require('@axis-dsl/language-service');
await writeFile(
    join(dist, 'language-configuration.json'),
    JSON.stringify(
        { ...AXIS_LANGUAGE_CONFIGURATION, wordPattern: AXIS_WORD_PATTERN.source },
        null,
        4,
    ) + '\n',
);

// ── Bundles ─────────────────────────────────────────────────────────────────

/** @type {import('esbuild').BuildOptions} */
const options = {
    absWorkingDir: extensionRoot,
    entryPoints: {
        extension: 'src/extension.ts',
        server: 'src/language-server.ts',
    },
    outdir: 'dist',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // The Node the VSCode 1.134 extension host runs.
    target: 'node22',
    // Provided by the extension host at runtime, and by nothing else.
    external: ['vscode'],
    sourcemap: true,
    logLevel: 'info',
};

if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
} else {
    await esbuild.build(options);
}
