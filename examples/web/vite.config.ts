import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packagesDir = fileURLToPath(new URL('../../packages/', import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: {
        // Compile the workspace packages from TypeScript source rather than
        // their built CommonJS output (which only the VSCode extension host
        // needs). Editing a shared package hot-reloads here with no build step,
        // and there is no second artifact to keep in sync. tsconfig.json
        // mirrors this as `paths` entries.
        alias: [
            // Subpath exports (`@axis-dsl/language/monaco`) first: each is a
            // directory of its own under src/.
            {
                find: /^@axis-dsl\/([^/]+)\/(.+)$/,
                replacement: `${packagesDir}$1/src/$2/index.ts`,
            },
            { find: /^@axis-dsl\/([^/]+)$/, replacement: `${packagesDir}$1/src/index.ts` },
        ],
    },
    build: {
        rollupOptions: {
            output: {
                // Monaco dwarfs the app code and changes far less often, so it
                // gets its own long-lived chunk. Rolldown, which Vite bundles
                // with from 8.x, takes only the function form.
                manualChunks(id: string) {
                    return id.includes('monaco-editor') ? 'monaco' : undefined;
                },
            },
        },
    },
    server: {
        port: 5173,
    },
});
