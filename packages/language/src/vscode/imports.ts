// ═════════════════════════════════════════════════════════════════════════════
// Paths - what an import or an image names in a VSCode workspace
// ═════════════════════════════════════════════════════════════════════════════

import * as vscode from 'vscode';
import { AxisDirectoryEntry, withAxisExtension } from '../index';

/**
 * The file `specifier`, written in the file at `from`, names.
 *
 * Relative to the importing file, as an import in any other language is. A
 * leading `/` is relative to the workspace folder instead: a script that names
 * an absolute path on the machine it was written on is not one anybody else can
 * open.
 */
export function resolveImportUri(from: vscode.Uri, specifier: string): vscode.Uri {
    return resolveFileUri(from, withAxisExtension(specifier));
}

/**
 * The image file `url`, written in the file at `from`, names.
 *
 * The same resolution an import gets, minus the implied extension: a picture is
 * named in full, `.png` and all.
 */
export function resolveImageUri(from: vscode.Uri, url: string): vscode.Uri {
    return resolveFileUri(from, url);
}

function resolveFileUri(from: vscode.Uri, target: string): vscode.Uri {
    const directory = vscode.Uri.joinPath(from, '..');

    if (!target.startsWith('/')) {
        return vscode.Uri.joinPath(directory, target);
    }

    const workspace = vscode.workspace.getWorkspaceFolder(from);
    return vscode.Uri.joinPath(workspace?.uri ?? directory, target.slice(1));
}

/**
 * The directory a half-typed path is inside, for completing the rest of it.
 *
 * An empty `directory` is the one the file itself is in, which is what a path
 * with no `/` in it yet is relative to.
 */
export function resolveDirectoryUri(from: vscode.Uri, directory: string): vscode.Uri {
    return resolveFileUri(from, directory === '' ? './' : directory);
}

/** What is in `uri`, or nothing at all when it is not a directory we can read. */
export async function readDirectory(uri: vscode.Uri): Promise<AxisDirectoryEntry[]> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        return entries.map(([name, type]) => ({
            name,
            directory: (type & vscode.FileType.Directory) !== 0,
        }));
    } catch {
        return [];
    }
}

/** True when there is a file at `uri`. A directory is neither script nor picture. */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return (stat.type & vscode.FileType.File) !== 0;
    } catch {
        return false;
    }
}
