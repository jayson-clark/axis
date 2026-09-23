import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import { AXIS_FILE_EXTENSION, AXIS_LANGUAGE_ID } from '@axis-dsl/language-service';
import { createLanguageClient } from './client';
import { PreviewServer } from './preview-server';
import { openPreview, resolvePreviewTarget } from './preview';
import { PreviewStatus } from './status';

/** A document VSCode has recognised as Axis, or one that simply ends in `.axis`. */
function isAxisDocument(document: vscode.TextDocument): boolean {
    return (
        document.languageId === AXIS_LANGUAGE_ID || document.fileName.endsWith(AXIS_FILE_EXTENSION)
    );
}

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
    // Constructed here but not started: the server listens on the first preview
    // and, for someone who only wants the language support, never at all.
    const server = new PreviewServer(context);
    const status = new PreviewStatus(server);

    context.subscriptions.push(
        server,
        status,
        vscode.commands.registerCommand('axis.preview', async (argument: unknown) => {
            const uri = await resolvePreviewTarget(argument, isAxisDocument);
            if (uri) {
                await openPreview(server, uri);
            }
        }),
        vscode.commands.registerCommand('axis.previewStatus', () => status.showMenu()),
        vscode.commands.registerCommand('axis.stopPreviewServer', () => server.stop()),
    );

    // Completion, formatting, diagnostics and the rest, from the language
    // server. Started last and not awaited by the commands above, so a server
    // that is slow to come up - or fails to - never holds the preview hostage.
    client = createLanguageClient(context);
    try {
        await client.start();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`The Axis language server did not start: ${message}`);
    }
}

export async function deactivate() {
    await client?.stop();
    client = undefined;
}
