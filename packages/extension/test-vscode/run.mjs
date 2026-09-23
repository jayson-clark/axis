// A smoke test in a real VSCode: `pnpm --filter axis-dsl test:vscode`.
//
// Downloads a VSCode build the first time (into .vscode-test/, which is
// ignored), opens a scratch workspace in it with only this extension loaded,
// and runs `suite.cjs` inside the extension host. Kept out of `pnpm test`,
// which has to run anywhere, because this needs the download and a display.
//
// Build first: it runs the bundles in dist/, as a packaged .vsix would.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = dirname(here);
const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'axis-vscode-')));
writeFileSync(join(workspace, 'lib.axis'), 'style loud { color: RED }\n');
// Short, because VSCode puts a socket in it and macOS caps a socket's path at
// 104 characters - which one inside a checkout nested this deep runs past.
const userData = realpathSync(mkdtempSync(join(tmpdir(), 'axis-ud-')));

try {
    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath: join(here, 'suite.cjs'),
        launchArgs: [
            workspace,
            '--disable-extensions',
            '--skip-welcome',
            `--user-data-dir=${userData}`,
        ],
        extensionTestsEnv: { AXIS_TEST_WORKSPACE: workspace },
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
}
