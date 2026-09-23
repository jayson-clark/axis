// ═════════════════════════════════════════════════════════════════════════════
// Imports and images, as the preview reads them
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler asks for an import's source, or an image's bytes, and is handed
// them; finding the file and reading it is the host's job. Here that is
// VSCode's filesystem API rather than Node's, so a preview works the same on a
// remote or virtual workspace as it does on a local folder.
//
// The resolution is the language server's (`@axis-dsl/language-server`'s
// `paths.ts`), written again over `vscode.Uri`: relative to the file, `.axis`
// implied on an import, and a leading `/` relative to the workspace folder.
// The two must agree, or a path that squiggles in the editor would draw in the
// preview, or the other way round.

import * as vscode from 'vscode';
import type { ImageHost, ImportHost } from '@axis-dsl/compiler';
import { withAxisExtension } from '@axis-dsl/language-service';

/** The file `target`, written in the file at `from`, names. */
function resolveFileUri(from: vscode.Uri, target: string): vscode.Uri {
    const directory = vscode.Uri.joinPath(from, '..');

    if (!target.startsWith('/')) {
        return vscode.Uri.joinPath(directory, target);
    }

    // A script that names an absolute path on the machine it was written on
    // is not one anybody else can open, so `/` is the workspace folder.
    const workspace = vscode.workspace.getWorkspaceFolder(from);
    return vscode.Uri.joinPath(workspace?.uri ?? directory, target.slice(1));
}

/**
 * Files are keyed by URI string throughout, so the compiler's cycle detection
 * and the preview's watchers agree on what counts as the same file.
 */
export const importHost: ImportHost = {
    resolve: (specifier, from) =>
        resolveFileUri(vscode.Uri.parse(from), withAxisExtension(specifier)).toString(),
    read: async path =>
        new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(path))),
};

/** The same, for the pictures an `image "./beach.png"` inlines - named in full, extension and all. */
export const imageHost: ImageHost = {
    resolve: (url, from) => resolveFileUri(vscode.Uri.parse(from), url).toString(),
    read: path => Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.parse(path))),
};
