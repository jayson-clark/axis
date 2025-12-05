import * as vscode from 'vscode';
import { compileAxis } from '@axis-dsl/compiler';
import { DESMOS_SCRIPT_ORIGIN } from '@axis-dsl/desmos';
import type { HostMessage, ViewerMessage } from '@axis-dsl/protocol';
import { resolveDesmosApiKey } from './config';

/** How long an edit sits before the graph is recompiled. */
const DEBOUNCE_MS = 200;

/**
 * The viewer bundle inside this extension's `dist`, copied there at build time
 * by `scripts/copy-viewer-bundle.mjs`. Deliberately not named after any module
 * in `src/`: `tsc` emits into the same folder and would overwrite it.
 */
const VIEWER_BUNDLE = 'viewer.js';

/**
 * The panel's only markup: a root element and the viewer bundle.
 *
 * The Content-Security-Policy is what keeps a scripts-enabled webview from
 * being able to run anything it likes. The value here is the origin allowlist:
 * with `default-src 'none'`, the only code that runs is the viewer bundle -
 * tagged with a single-use nonce - and Desmos' own calculator, and the
 * calculator's origin is the only one the panel may talk to.
 *
 * `unsafe-eval` is there because the calculator bundle uses `new Function`.
 * It is the one concession; if Desmos ever drops that, drop this with it.
 */
function html(webview: vscode.Webview, bundleUri: vscode.Uri, nonce: string): string {
    const self = webview.cspSource;
    const csp = [
        `default-src 'none'`,
        `script-src 'nonce-${nonce}' 'unsafe-eval' ${DESMOS_SCRIPT_ORIGIN}`,
        // Desmos and the viewer both style themselves from JavaScript.
        `style-src ${self} ${DESMOS_SCRIPT_ORIGIN} 'unsafe-inline'`,
        `font-src ${self} ${DESMOS_SCRIPT_ORIGIN} data:`,
        `img-src ${self} ${DESMOS_SCRIPT_ORIGIN} data: blob:`,
        `connect-src ${DESMOS_SCRIPT_ORIGIN}`,
        `worker-src blob:`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Axis</title>
    <style nonce="${nonce}">
        html, body, #root { height: 100%; margin: 0; overflow: hidden; }
    </style>
</head>

<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${bundleUri}"></script>
</body>

</html>`;
}

function createNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () =>
        alphabet.charAt(Math.floor(Math.random() * alphabet.length)),
    ).join('');
}

export class WebviewPanel {
    public static readonly viewType = 'axis.webview';

    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
    /** Fires once, when the panel is closed. */
    public readonly onDidDispose = this.onDidDisposeEmitter.event;

    /** Watchers for the file currently on screen, replaced when it changes. */
    private fileSubscriptions: vscode.Disposable[] = [];
    private axisFileUri: vscode.Uri | undefined;
    private compileTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;

    constructor(context: vscode.ExtensionContext, axisFileUri?: vscode.Uri) {
        // The viewer bundle is copied into this extension's own dist at build
        // time, so a packaged .vsix carries everything the panel needs.
        const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');

        // Open beside the active editor.
        const active = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        const column =
            active === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One;

        this.panel = vscode.window.createWebviewPanel(WebviewPanel.viewType, 'Axis', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [dist],
        });

        this.panel.webview.html = html(
            this.panel.webview,
            this.panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, VIEWER_BUNDLE)),
            createNonce(),
        );

        this.disposables.push(
            this.panel.onDidDispose(() => this.dispose()),
            this.panel.webview.onDidReceiveMessage((message: HostMessage) =>
                this.handleViewerMessage(message),
            ),
        );

        if (axisFileUri) {
            this.setAxisFile(axisFileUri);
        }
    }

    /** Point the panel at a `.axis` file and follow it as it changes. */
    public setAxisFile(uri: vscode.Uri) {
        this.axisFileUri = uri;

        // Only ever one file's worth of watchers: disposing them here is what
        // keeps switching files from accumulating subscriptions.
        this.fileSubscriptions.forEach(subscription => subscription.dispose());

        // Unsaved edits are what the preview is for, so the open document
        // drives it; the file watcher covers changes made outside the editor.
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), basename(uri)),
        );

        this.fileSubscriptions = [
            watcher,
            watcher.onDidChange(() => this.scheduleCompile()),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.toString() === this.axisFileUri?.toString()) {
                    this.scheduleCompile();
                }
            }),
        ];

        void this.compileAndSendExpressions();
    }

    public reveal() {
        this.panel.reveal();
    }

    private scheduleCompile() {
        clearTimeout(this.compileTimer);
        this.compileTimer = setTimeout(() => void this.compileAndSendExpressions(), DEBOUNCE_MS);
    }

    private async compileAndSendExpressions() {
        if (!this.axisFileUri || this.disposed) {
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(this.axisFileUri);
            const { expressions, settings } = compileAxis(document.getText());
            this.post({ command: 'setExpressions', data: { expressions, settings } });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Error compiling axis file: ${message}`);
        }
    }

    /** Typed by the protocol, so the two ends cannot drift. */
    private post(message: ViewerMessage) {
        if (!this.disposed) {
            void this.panel.webview.postMessage(message);
        }
    }

    private handleViewerMessage(message: HostMessage) {
        switch (message.command) {
            case 'ready':
                this.post({
                    command: 'init',
                    data: { desmosApiKey: resolveDesmosApiKey(), canSetApiKey: true },
                });
                void this.compileAndSendExpressions();
                break;
            case 'requestApiKey':
                // Only the host knows where a key lives; the viewer just asks.
                void vscode.commands.executeCommand('workbench.action.openSettings', 'axis.apiKey');
                break;
        }
    }

    private dispose() {
        // Reached both from `onDidDispose` and from a caller closing the panel.
        if (this.disposed) {
            return;
        }
        this.disposed = true;

        clearTimeout(this.compileTimer);
        this.fileSubscriptions.forEach(subscription => subscription.dispose());
        this.fileSubscriptions = [];
        this.disposables.forEach(disposable => disposable.dispose());
        this.panel.dispose();

        this.onDidDisposeEmitter.fire();
        this.onDidDisposeEmitter.dispose();
    }
}

/** The file name of `uri`, without pulling in `path` for the one call. */
function basename(uri: vscode.Uri): string {
    return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}
