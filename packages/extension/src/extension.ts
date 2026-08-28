import * as vscode from 'vscode';
import {
    AXIS_FILE_EXTENSION,
    AXIS_LANGUAGE_ID,
    registerAxisLanguage,
} from '@axis-dsl/language/vscode';
import { PreviewServer } from './server';
import { openPreview, resolvePreviewTarget } from './preview';
import { PreviewStatus } from './status';

/** A document VSCode has recognised as Axis, or one that simply ends in `.axis`. */
function isAxisDocument(document: vscode.TextDocument): boolean {
    return (
        document.languageId === AXIS_LANGUAGE_ID || document.fileName.endsWith(AXIS_FILE_EXTENSION)
    );
}

export function activate(context: vscode.ExtensionContext) {
    // Constructed here but not started: the server listens on the first preview
    // and, for someone who only wants the language support, never at all.
    const server = new PreviewServer(context);
    const status = new PreviewStatus(server);

    context.subscriptions.push(
        server,
        status,
        // Completion, formatting and diagnostics, shared with the web app.
        ...registerAxisLanguage(),
        vscode.commands.registerCommand('axis.preview', async (argument: unknown) => {
            const uri = await resolvePreviewTarget(argument, isAxisDocument);
            if (uri) {
                await openPreview(server, uri);
            }
        }),
        vscode.commands.registerCommand('axis.previewStatus', () => status.showMenu()),
        vscode.commands.registerCommand('axis.stopPreviewServer', () => server.stop()),
    );
}

export function deactivate() {}
