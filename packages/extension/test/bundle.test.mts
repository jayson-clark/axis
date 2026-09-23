// The extension as it ships: what `scripts/build.mjs` wrote into dist/, read
// the way VSCode reads it. Nothing here starts VSCode - the language server is
// the part of the extension that runs outside the host, so that is the part
// started for real.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startClient } from '../../language-server/test/support.mts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8');
const manifest = JSON.parse(read('package.json'));

describe('the extension bundle', () => {
    test('has every file the manifest names', () => {
        const paths = [
            manifest.main,
            ...manifest.contributes.languages.flatMap(
                (language: { configuration: string; icon: { light: string; dark: string } }) => [
                    language.configuration,
                    language.icon.light,
                    language.icon.dark,
                ],
            ),
            ...manifest.contributes.grammars.map((grammar: { path: string }) => grammar.path),
            'dist/server.js',
            'dist/viewer.js',
        ];
        for (const path of paths) {
            assert.ok(existsSync(`${root}${path}`), path);
        }
    });

    test('requires nothing at runtime but node and vscode', () => {
        // A package left out of the bundle would be a `require` of something
        // the .vsix does not carry, and the extension would fail to activate.
        const builtins = new Set([
            ...builtinModules,
            ...builtinModules.map(name => `node:${name}`),
        ]);
        for (const bundle of ['dist/extension.js', 'dist/server.js']) {
            const required = [...read(bundle).matchAll(/\brequire\("([^"]+)"\)/g)].map(
                match => match[1],
            );
            const foreign = required.filter(name => !builtins.has(name) && name !== 'vscode');
            assert.deepEqual([...new Set(foreign)], [], bundle);
        }
        assert.doesNotMatch(read('dist/server.js'), /require\("vscode"\)/);
    });

    test('contributes the v2 grammar and a language configuration', () => {
        const [grammar] = manifest.contributes.grammars;
        assert.equal(JSON.parse(read(grammar.path)).scopeName, grammar.scopeName);

        const configuration = JSON.parse(read(manifest.contributes.languages[0].configuration));
        assert.equal(configuration.comments.lineComment, '//');
        assert.ok(new RegExp(configuration.wordPattern).test('x_1'));
    });

    test('depends on the language server it bundles', () => {
        const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
        assert.ok(dependencies['@axis-dsl/language-server']);
    });

    test('bundles a language server that answers', async () => {
        const client = await startClient({ server: `${root}dist/server.js` });
        try {
            const uri = 'untitled:Untitled-1';
            const published = client.diagnostics(uri);
            await client.open(uri, 'mean = 3\n');
            assert.deepEqual(
                (await published).map(diagnostic => diagnostic.code),
                ['assign-to-builtin'],
            );
        } finally {
            await client.close();
        }
    });
});
