import type * as monaco from 'monaco-editor/editor';

/**
 * The Monaco namespace, passed in so this package never bundles Monaco itself.
 * `monaco-editor/editor` is the editor API alone — the surface these bindings
 * use — so an app that skips Monaco's bundled languages still satisfies it.
 */
export type MonacoApi = typeof monaco;
