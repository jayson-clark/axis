// ═════════════════════════════════════════════════════════════════════════════
// Paths - what an import or an image names, as a URI
// ═════════════════════════════════════════════════════════════════════════════
//
// Every file is known by its URI string, the way the client names the
// documents it opens. That is the one identity the compiler's cycle detection,
// the open-document lookup, the dependency tracking and a definition's
// location all agree on - so a path is resolved straight to a URI rather than
// to a file-system path that would need converting back at every edge.
//
// `vscode-uri` builds them, because it is what VSCode builds them with: a
// Windows drive letter comes out as `file:///c%3A/…` from both, where Node's
// `pathToFileURL` would write `file:///C:/…` and miss the open document.

import { AXIS_FILE_EXTENSION } from '@axis-dsl/language-service';
import { URI, Utils } from 'vscode-uri';

/** `./curves` names `./curves.axis`: the extension may be left off an import (spec §7). */
export function withAxisExtension(specifier: string): string {
    return specifier.endsWith(AXIS_FILE_EXTENSION)
        ? specifier
        : `${specifier}${AXIS_FILE_EXTENSION}`;
}

/** A URI string written the way `vscode-uri` writes it, so two spellings of one file compare equal. */
export function normalizeUri(uri: string): string {
    return URI.parse(uri).toString();
}

/**
 * The file `target`, written in the file at `from`, names.
 *
 * Relative to the file it is written in, as an import in any other language
 * is. A leading `/` is relative to the workspace folder holding that file
 * instead (spec §7): a script that names an absolute path on the machine it was
 * written on is not one anybody else can open. Outside every workspace folder,
 * a leading `/` falls back to the file's own directory, as v1's extension did.
 */
export function resolveFileUri(from: string, target: string, roots: readonly string[]): string {
    const file = URI.parse(from);
    const directory = Utils.dirname(file);

    if (!target.startsWith('/')) {
        return Utils.joinPath(directory, target).toString();
    }

    const root = workspaceRootOf(file, roots);
    return Utils.joinPath(root ?? directory, target.slice(1)).toString();
}

/** The innermost workspace folder `file` is inside, if any. */
function workspaceRootOf(file: URI, roots: readonly string[]): URI | undefined {
    const path = file.toString();
    let best: string | undefined;
    for (const root of roots) {
        const prefix = root.endsWith('/') ? root : `${root}/`;
        if (path.startsWith(prefix) && (best === undefined || root.length > best.length)) {
            best = root;
        }
    }
    return best === undefined ? undefined : URI.parse(best);
}

/** What an `import` names: a script, `.axis` implied. */
export const resolveImportUri = (from: string, specifier: string, roots: readonly string[]) =>
    resolveFileUri(from, withAxisExtension(specifier), roots);

/** What an `image` names: a picture, named in full. */
export const resolveImageUri = (from: string, url: string, roots: readonly string[]) =>
    resolveFileUri(from, url, roots);

/**
 * The directory a half-typed path is inside, for completing the rest of it. An
 * empty `directory` is the file's own, which is what a path with no `/` in it
 * yet is relative to.
 */
export const resolveDirectoryUri = (from: string, directory: string, roots: readonly string[]) =>
    resolveFileUri(from, directory === '' ? './' : directory, roots);

/** The file-system path behind a `file:` URI, or undefined for any other scheme. */
export function fsPathOf(uri: string): string | undefined {
    const parsed = URI.parse(uri);
    return parsed.scheme === 'file' ? parsed.fsPath : undefined;
}
