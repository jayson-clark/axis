// ═════════════════════════════════════════════════════════════════════════════
// Monaco, loaded the way this app's bundler wants it
// ═════════════════════════════════════════════════════════════════════════════
//
// Loading Monaco and wiring its web workers is the app's job — every bundler
// spells it differently, so Axis registers itself on an instance the app
// supplies rather than importing one. This is the Vite spelling.

import * as monaco from 'monaco-editor/editor';
// `monaco-editor/editor` is the bare API; `features/register.all` adds every
// editor contribution — the suggest widget, formatting actions, find, folding
// — without Monaco's bundled languages, which Axis has no use for. (The
// `monaco-editor` root entry point would pull those in too.)
import 'monaco-editor/features/register.all';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

declare global {
    interface Window {
        MonacoEnvironment?: monaco.Environment;
    }
}

// Axis has no worker-backed language service, so every worker request is for
// the generic editor worker (tokenization, diffs, basic word suggestions).
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export { monaco };
