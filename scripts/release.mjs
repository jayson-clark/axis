#!/usr/bin/env node
// Prepares a release: `node scripts/release.mjs 2.2.0`.
//
// It sets every package to the version through `scripts/version.mjs` and moves
// what CHANGELOG.md has under "Unreleased" into a section of its own, dated
// today, leaving an empty "Unreleased" above it for the next round of pull
// requests. It commits and tags nothing: the diff is there to read first, and
// the commands that finish the release are printed at the end. Pushing the tag
// is what publishes, through .github/workflows/release.yml.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogPath, section } from './changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error('usage: node scripts/release.mjs <major.minor.patch[-prerelease]>');
    process.exit(1);
}

const changelog = readFileSync(changelogPath, 'utf8');

// Checked before anything is written, so a refused release leaves the tree as
// it found it.
if (section(changelog, version) !== undefined) {
    console.error(`CHANGELOG.md already has a section for ${version}`);
    process.exit(1);
}
const unreleased = section(changelog, 'Unreleased');
if (unreleased === undefined) {
    console.error('CHANGELOG.md has no "## Unreleased" section');
    process.exit(1);
}
if (unreleased === '') {
    console.error(
        'Nothing is listed under "## Unreleased" in CHANGELOG.md, so there is nothing to release',
    );
    process.exit(1);
}

execFileSync(process.execPath, [join(root, 'scripts/version.mjs'), version], { stdio: 'inherit' });

// Local rather than UTC, so an evening release is dated the day it was made.
const date = new Date().toLocaleDateString('en-CA');
writeFileSync(
    changelogPath,
    changelog.replace(/^## Unreleased$/m, `## Unreleased\n\n## ${version} - ${date}`),
);
console.log(`CHANGELOG.md                 Unreleased → ${version} - ${date}`);

console.log(`
Read the diff, then:

    git commit -am "Release ${version}"
    git tag v${version}
    git push origin HEAD v${version}
`);
