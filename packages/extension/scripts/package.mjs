// Packages the built extension as a .vsix, from a staging folder.
//
// vsce reads package.json as it is written, and this one's is written for
// pnpm: `catalog:` and `workspace:*` versions, which vsce cannot parse - it
// checks `@types/vscode` against `engines.vscode` and stops at the first. The
// extension needs none of them at runtime, since `scripts/build.mjs` bundles
// everything into dist/, so the staged manifest leaves the dependencies and
// scripts out altogether and vsce packs exactly what `.vscodeignore` lets
// through.
//
// Arguments are passed on to `vsce package`; without `-o`, the .vsix is
// written beside this package.json.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(extensionRoot, 'package.json'), 'utf8'));
const stage = await mkdtemp(join(tmpdir(), 'axis-vsix-'));

try {
    for (const entry of ['README.md', 'LICENSE', '.vscodeignore', 'icons', 'dist']) {
        await cp(join(extensionRoot, entry), join(stage, entry), { recursive: true });
    }
    const { devDependencies: _dev, dependencies: _deps, scripts: _scripts, ...staged } = manifest;
    await writeFile(join(stage, 'package.json'), JSON.stringify(staged, null, 4) + '\n');

    const args = process.argv.slice(2);
    if (!args.includes('-o') && !args.includes('--out')) {
        args.push('--out', join(extensionRoot, `${manifest.name}-${manifest.version}.vsix`));
    }
    execFileSync(
        join(extensionRoot, 'node_modules', '.bin', 'vsce'),
        ['package', '--no-dependencies', ...args],
        { cwd: stage, stdio: 'inherit' },
    );
} finally {
    await rm(stage, { recursive: true, force: true });
}
