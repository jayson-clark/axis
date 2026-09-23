#!/usr/bin/env node
// Prints what CHANGELOG.md says about one release: `node scripts/changelog.mjs 2.1.0`.
//
// The release workflow uses it for the notes on the GitHub release, and fails
// when it finds nothing - a tag pushed without its changelog section was cut
// by hand rather than by `scripts/release.mjs`, and should not be published.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const changelogPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');

/**
 * The body of the `## <heading>` section, up to the next `## `, trimmed; or
 * undefined when there is no such heading. A heading may carry a date after
 * the version, `## 2.1.0 - 2026-09-22`.
 */
export function section(text, heading) {
    const lines = text.split('\n');
    const start = lines.findIndex(
        line => line === `## ${heading}` || line.startsWith(`## ${heading} `),
    );
    if (start === -1) return undefined;
    const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
    return lines
        .slice(start + 1, end === -1 ? undefined : end)
        .join('\n')
        .trim();
}

// Run as a script rather than imported by `scripts/release.mjs`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const version = process.argv[2];
    if (!version) {
        console.error('usage: node scripts/changelog.mjs <version>');
        process.exit(1);
    }

    const notes = section(readFileSync(changelogPath, 'utf8'), version);
    if (!notes) {
        console.error(`CHANGELOG.md has no entries under "## ${version}"`);
        process.exit(1);
    }
    console.log(notes);
}
