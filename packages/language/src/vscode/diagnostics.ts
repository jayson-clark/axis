// ═════════════════════════════════════════════════════════════════════════════
// Diagnostics - VSCode problem markers
// ═════════════════════════════════════════════════════════════════════════════

import * as vscode from 'vscode';
import {
    AXIS_FILE_EXTENSION,
    AXIS_LANGUAGE_ID,
    AxisDiagnostic,
    createDebouncer,
    findImportStatements,
    missingImportDiagnostic,
    validateAxis,
} from '../index';
import { importExists, resolveImportUri } from './imports';

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

    /**
     * Report the imports that name a file which is not there.
     *
     * Split out from the checks above because it is the only one that has to
     * ask the filesystem, and so the only one that cannot answer immediately.
     * The syntax diagnostics are already on screen by the time this runs; it
     * adds to them, and only if the document has not moved on in the meantime.
     */
    const checkImports = async (document: vscode.TextDocument, checked: vscode.Diagnostic[]) => {
        const { version } = document;
        const imports = findImportStatements(document.getText());

        const missing = await Promise.all(
            imports.map(async statement =>
                (await importExists(resolveImportUri(document.uri, statement.specifier)))
                    ? undefined
                    : toVscodeDiagnostic(missingImportDiagnostic(statement)),
            ),
        );

        const found = missing.filter((diagnostic): diagnostic is vscode.Diagnostic =>
            Boolean(diagnostic),
        );
        if (found.length > 0 && document.version === version) {
            collection.set(document.uri, [...checked, ...found]);
        }
    };

    const validate = (document: vscode.TextDocument) => {
        if (document.languageId !== AXIS_LANGUAGE_ID) {
            collection.delete(document.uri);
            return;
        }

        const diagnostics = validateAxis(document.getText()).map(toVscodeDiagnostic);
        collection.set(document.uri, diagnostics);
        void checkImports(document, diagnostics);
    };

    const forget = (document: vscode.TextDocument) => {
        pending.cancel(document.uri.toString());
        collection.delete(document.uri);
    };

    // Creating the file an import names has to clear that import's error, and
    // deleting one has to raise it, neither of which is an edit to the document
    // holding the import.
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*${AXIS_FILE_EXTENSION}`);
    const revalidate = () => vscode.workspace.textDocuments.forEach(validate);

    vscode.workspace.textDocuments.forEach(validate);

    return [
        collection,
        watcher,
        watcher.onDidCreate(revalidate),
        watcher.onDidDelete(revalidate),
        vscode.workspace.onDidOpenTextDocument(validate),
        vscode.workspace.onDidChangeTextDocument(event =>
            pending.schedule(event.document.uri.toString(), () => validate(event.document)),
        ),
        vscode.workspace.onDidCloseTextDocument(forget),
        new vscode.Disposable(() => pending.dispose()),
    ];
}
