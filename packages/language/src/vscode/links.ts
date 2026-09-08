// ═════════════════════════════════════════════════════════════════════════════
// Document links - opening the file a path names
// ═════════════════════════════════════════════════════════════════════════════

import * as vscode from 'vscode';
import { AxisLink, findAxisLinks } from '../index';
import { resolveImageUri, resolveImportUri } from './imports';

/** The address a link points at, resolved the way its statement resolves one. */
function targetOf(document: vscode.TextDocument, link: AxisLink): vscode.Uri {
    switch (link.kind) {
        case 'import':
            return resolveImportUri(document.uri, link.target);
        case 'image':
            return resolveImageUri(document.uri, link.target);
        case 'url':
            return vscode.Uri.parse(link.target);
    }
}

/**
 * Ctrl-click on the path in an `import` or an `image`.
 *
 * Nothing here asks whether the file is there. A link to a file that does not
 * exist opens an error VSCode words itself, and the path is already underlined
 * by the diagnostics - so checking would buy a slower editor and a second way
 * of saying the same thing.
 */
export class AxisDocumentLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.DocumentLink[] {
        return findAxisLinks(document.getText()).map(link => {
            const range = new vscode.Range(
                link.line,
                link.startCharacter,
                link.line,
                link.endCharacter,
            );

            const created = new vscode.DocumentLink(range, targetOf(document, link));
            created.tooltip = link.kind === 'url' ? undefined : `Open ${link.target}`;
            return created;
        });
    }
}
