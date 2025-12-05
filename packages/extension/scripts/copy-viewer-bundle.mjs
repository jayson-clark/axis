// The webview's UI is @axis-dsl/viewer, built as a single esbuild bundle. Copy
// it into this extension's own dist so a packaged .vsix carries it: reaching
// across to ../viewer/dist works only inside the monorepo, and localResourceRoots
// would have to be widened to allow it.
//
// The target name must not collide with anything `tsc` emits from src/, which
// shares this folder and would otherwise overwrite the bundle on the next build.
// It is `VIEWER_BUNDLE` in src/panel.ts.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(extensionRoot, '..', 'viewer', 'dist', 'webview.js');
const target = join(extensionRoot, 'dist', 'viewer.js');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
