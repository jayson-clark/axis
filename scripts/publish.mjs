#!/usr/bin/env node
// Publishes every public package to npm at one version: `node scripts/publish.mjs 2.2.0`.
//
// This is the release workflow's job, run on the commit a `v*` tag points at,
// and it refuses unless every package is already at the tag's version - the
// tag and `scripts/version.mjs` have to agree about what is being released.
//
// Each package is packed by pnpm, which writes its `workspace:*` and
// `catalog:` dependencies out as real versions, and the tarball is published
// by npm, which is what signs it with provenance. A version already on the
// registry is skipped rather than failed, so a run that died half way through
// can be run again. `--dry-run` does everything but the upload.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [version, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

if (!version) {
    console.error('usage: node scripts/publish.mjs <version> [--dry-run]');
    process.exit(1);
}

// The examples and the docs site are workspace packages too, but private;
// only packages/ publishes, and the extension goes to the Marketplace instead.
const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(root, 'packages', entry.name))
    .filter(dir => existsSync(join(dir, 'package.json')))
    .map(dir => ({ dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
    .filter(({ manifest }) => !manifest.private);

const mismatched = packages.filter(({ manifest }) => manifest.version !== version);
if (mismatched.length > 0) {
    for (const { manifest } of mismatched) {
        console.error(`${manifest.name} is at ${manifest.version}, not ${version}`);
    }
    console.error(
        'Run `node scripts/release.mjs` before tagging, so the tag and the packages agree.',
    );
    process.exit(1);
}

// npm will not put a prerelease on `latest`, which is what every install
// without a version asks for.
const distTag = version.includes('-') ? 'next' : 'latest';

for (const { dir, manifest } of packages) {
    const spec = `${manifest.name}@${version}`;
    if (published(spec)) {
        console.log(`${spec.padEnd(36)} already published`);
        continue;
    }

    const out = mkdtempSync(join(tmpdir(), 'axis-pack-'));
    try {
        execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: dir, stdio: 'ignore' });
        const [tarball] = readdirSync(out).filter(name => name.endsWith('.tgz'));
        execFileSync(
            'npm',
            [
                'publish',
                join(out, tarball),
                '--access',
                'public',
                '--tag',
                distTag,
                // Provenance needs the OIDC token only CI has.
                ...(process.env.CI ? ['--provenance'] : []),
                ...(dryRun ? ['--dry-run'] : []),
            ],
            { stdio: 'inherit' },
        );
        console.log(`${spec.padEnd(36)} ${dryRun ? 'would be published' : 'published'}`);
    } finally {
        rmSync(out, { recursive: true, force: true });
    }
}

function published(spec) {
    try {
        return execFileSync('npm', ['view', spec, 'version'], { encoding: 'utf8' }).trim() !== '';
    } catch {
        // npm view exits non-zero with E404 for a version it has never seen.
        return false;
    }
}
