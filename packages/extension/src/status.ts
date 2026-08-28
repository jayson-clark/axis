import * as vscode from 'vscode';
import { basename, PreviewServer } from './server';
import { reopenPreview } from './preview';

/**
 * The "server is running" indicator, and the way to act on it.
 *
 * A dev server you cannot see is a dev server you forget is running, so this
 * sits in the status bar for exactly as long as the server is listening and
 * disappears the moment it stops. Clicking it is how a preview gets reopened
 * after the tab was closed, and how the server gets shut down.
 */
export class PreviewStatus implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly server: PreviewServer) {
        // Right-aligned with a high priority, which is where VSCode's own
        // run/port indicators sit.
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'axis.previewStatus';
        this.item.name = 'Axis Preview';

        this.disposables.push(
            this.item,
            this.server.onDidChange(() => this.render()),
        );
        this.render();
    }

    private render() {
        if (!this.server.isRunning) {
            this.item.hide();
            return;
        }

        const sessions = this.server.sessions;
        const viewers = sessions.reduce((total, session) => total + session.viewers, 0);
        this.item.text = `$(broadcast) Axis${viewers > 0 ? ` ${viewers}` : ''}`;

        const tooltip = new vscode.MarkdownString(
            `**Axis preview server** — ${this.server.address}\n\n`,
        );
        if (sessions.length === 0) {
            tooltip.appendMarkdown('_Serving nothing yet_');
        } else {
            for (const session of sessions) {
                const count =
                    session.viewers === 0
                        ? 'no viewers'
                        : `${session.viewers} viewer${session.viewers === 1 ? '' : 's'}`;
                tooltip.appendMarkdown(`- \`${basename(session.uri)}\` — ${count}\n`);
            }
        }
        this.item.tooltip = tooltip;
        this.item.show();
    }

    /** The menu behind the status bar item. */
    public async showMenu() {
        const sessions = this.server.sessions;

        interface Item extends vscode.QuickPickItem {
            run?: () => Thenable<void> | void;
        }

        const items: Item[] = [];
        if (sessions.length > 0) {
            items.push({ label: 'Serving', kind: vscode.QuickPickItemKind.Separator });
            for (const session of sessions) {
                items.push({
                    label: `$(link-external) ${basename(session.uri)}`,
                    description:
                        session.viewers === 0 ? 'no viewers' : `${session.viewers} viewers`,
                    detail: vscode.workspace.asRelativePath(session.uri),
                    run: () => reopenPreview(this.server, session.uri),
                });
            }
        }

        items.push(
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: '$(add) Preview another file…',
                run: () => vscode.commands.executeCommand('axis.preview'),
            },
            {
                label: '$(stop-circle) Stop the preview server',
                detail: this.server.address,
                run: () => vscode.commands.executeCommand('axis.stopPreviewServer'),
            },
        );

        const picked = await vscode.window.showQuickPick(items, { title: 'Axis preview server' });
        await picked?.run?.();
    }

    public dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
