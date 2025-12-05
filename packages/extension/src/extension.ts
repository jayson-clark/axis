import * as vscode from 'vscode';
import {
    AXIS_FILE_EXTENSION,
    AXIS_LANGUAGE_ID,
    registerAxisLanguage,
} from '@axis-dsl/language/vscode';
import { WebviewPanel } from './panel';

/** A document VSCode has recognised as Axis, or one that simply ends in `.axis`. */
function isAxisDocument(document: vscode.TextDocument): boolean {
    return (
        document.languageId === AXIS_LANGUAGE_ID || document.fileName.endsWith(AXIS_FILE_EXTENSION)
    );
}

export function activate(context: vscode.ExtensionContext) {
    // There is one panel at a time. It lives in this closure rather than in
    // module state, so a deactivate/activate cycle starts from nothing.
    let panel: WebviewPanel | undefined;

    /** Show `document` in the panel, opening one if there is none. */
    const openWebview = (document?: vscode.TextDocument) => {
        if (!panel) {
            panel = new WebviewPanel(context, document?.uri);
            panel.onDidDispose(() => {
                panel = undefined;
            });
            return;
        }

        if (document) {
            panel.setAxisFile(document.uri);
        }
        panel.reveal();
    };

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && isAxisDocument(activeDocument)) {
        openWebview(activeDocument);
    }

    context.subscriptions.push(
        // Completion, formatting and diagnostics, shared with the web app.
        ...registerAxisLanguage(),
        vscode.commands.registerCommand('axis.openWebview', () => openWebview()),
        vscode.workspace.onDidOpenTextDocument(document => {
            if (isAxisDocument(document)) {
                openWebview(document);
            }
        }),
    );
}

export function deactivate() {}
