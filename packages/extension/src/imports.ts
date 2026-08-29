// ═════════════════════════════════════════════════════════════════════════════
// Imports, as this host reads them
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler asks for an import's source and is handed text; finding the file
// and reading it is the host's job. Here that is VSCode's filesystem API rather
// than Node's, so a preview works the same on a remote or virtual workspace as
// it does on a local folder - and the same resolution the editor's diagnostics
// use, so a path that squiggles in the editor is a path the preview cannot
// find either.

import * as vscode from 'vscode';
import type { ImportHost } from '@axis-dsl/compiler';
import { resolveImportUri } from '@axis-dsl/language/vscode';

/**
 * Files are keyed by URI string throughout, so the compiler's cycle detection
 * and the preview's watchers agree on what counts as the same file.
 */
export const importHost: ImportHost = {
    resolve: (specifier, from) => resolveImportUri(vscode.Uri.parse(from), specifier).toString(),
    read: async path =>
        new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(path))),
};
