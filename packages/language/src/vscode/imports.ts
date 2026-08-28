// ═════════════════════════════════════════════════════════════════════════════
// Imports - what a specifier names in a VSCode workspace
// ═════════════════════════════════════════════════════════════════════════════

import * as vscode from 'vscode';
import { withAxisExtension } from '../index';

/**
 * The file `specifier`, written in the file at `from`, names.
 *
 * Relative to the importing file, as an import in any other language is. A
 * leading `/` is relative to the workspace folder instead: a script that names
 * an absolute path on the machine it was written on is not one anybody else can
 * open.
 */
export function resolveImportUri(from: vscode.Uri, specifier: string): vscode.Uri {
    const target = withAxisExtension(specifier);
    const directory = vscode.Uri.joinPath(from, '..');

    if (!target.startsWith('/')) {
        return vscode.Uri.joinPath(directory, target);
    }

    const workspace = vscode.workspace.getWorkspaceFolder(from);
    return vscode.Uri.joinPath(workspace?.uri ?? directory, target.slice(1));
}

/** True when there is a file at `uri`. A directory is not a script. */
export async function importExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}
