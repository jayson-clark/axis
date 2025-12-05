// ═════════════════════════════════════════════════════════════════════════════
// Diagnostics - VSCode problem markers
// ═════════════════════════════════════════════════════════════════════════════

import * as vscode from 'vscode';
import { AXIS_LANGUAGE_ID, AxisDiagnostic, createDebouncer, validateAxis } from '../index';

/** How long an edit sits before the document is re-checked. */
const DEBOUNCE_MS = 250;

function toVscodeDiagnostic(diagnostic: AxisDiagnostic): vscode.Diagnostic {
    const range = new vscode.Range(
        diagnostic.line,
        diagnostic.startCharacter,
        diagnostic.line,
        diagnostic.endCharacter,
    );

    const result = new vscode.Diagnostic(
        range,
        diagnostic.message,
        diagnostic.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
    );
    result.source = 'axis';
    result.code = diagnostic.code;
    return result;
}

/**
 * Check every open Axis document and keep the Problems panel in step with it.
 *
 * @returns disposables the caller pushes onto its extension subscriptions; the
 *          diagnostic collection is among them, so disposing clears the panel.
 */
export function registerAxisDiagnostics(): vscode.Disposable[] {
    const collection = vscode.languages.createDiagnosticCollection(AXIS_LANGUAGE_ID);
    const pending = createDebouncer<string>(DEBOUNCE_MS);

    const validate = (document: vscode.TextDocument) => {
        if (document.languageId !== AXIS_LANGUAGE_ID) {
            collection.delete(document.uri);
            return;
        }
        collection.set(document.uri, validateAxis(document.getText()).map(toVscodeDiagnostic));
    };

    const forget = (document: vscode.TextDocument) => {
        pending.cancel(document.uri.toString());
        collection.delete(document.uri);
    };

    vscode.workspace.textDocuments.forEach(validate);

    return [
        collection,
        vscode.workspace.onDidOpenTextDocument(validate),
        vscode.workspace.onDidChangeTextDocument(event =>
            pending.schedule(event.document.uri.toString(), () => validate(event.document)),
        ),
        vscode.workspace.onDidCloseTextDocument(forget),
        new vscode.Disposable(() => pending.dispose()),
    ];
}
