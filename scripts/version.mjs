#!/usr/bin/env node
// Sets every package in the repo to one version: `node scripts/version.mjs 2.0.1`.
//
// Axis releases in lockstep. The packages depend on each other as
// `workspace:*`, which pnpm writes out as the exact version when it packs one,
// so a release where they disagreed would publish a compiler pinned to a syntax
// nobody released. One number for all of them makes that impossible, and makes
// "which Axis is this" a question with one answer.
//
// The file is edited as text rather than parsed and re-serialised, so nothing
// but the version line changes - key order, indentation and all.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error('usage: node scripts/version.mjs <major.minor.patch[-prerelease]>');
    process.exit(1);
}

// Everything pnpm-workspace.yaml names as a package: a directory under
// `packages/` with a package.json of its own, and the docs site.
const manifests = [
    ...readdirSync(join(root, 'packages'), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => join(root, 'packages', entry.name, 'package.json')),
    join(root, 'docs/site/package.json'),
].filter(existsSync);

for (const path of manifests) {
    const text = readFileSync(path, 'utf8');
    const { name, version: previous } = JSON.parse(text);
    if (previous === undefined) continue;

    // The first `"version"` is the package's own: it sits at the top level,
    // ahead of any nested object that could hold another.
    const updated = text.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`);
    writeFileSync(path, updated);
    console.log(`${name.padEnd(28)} ${previous} → ${version}   ${relative(root, path)}`);
}
