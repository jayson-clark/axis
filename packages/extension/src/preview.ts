import * as vscode from 'vscode';
import { basename, PreviewServer } from './server';

/** Where a preview opens. Mirrors the `axis.previewTarget` setting's values. */
export type PreviewTarget = 'editor' | 'browser';

const TARGET_SETTING = 'previewTarget';

/**
 * VSCode ships Simple Browser as a built-in extension, so this command is
 * always there. It takes the URL as a string, not a Uri.
 */
const SIMPLE_BROWSER_COMMAND = 'simpleBrowser.show';

const PIN_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('pin'),
    tooltip: 'Always open previews here',
};

interface TargetChoice extends vscode.QuickPickItem {
    target: PreviewTarget;
}

const CHOICES: TargetChoice[] = [
    {
        target: 'editor',
        label: '$(preview) VSCode',
        detail: 'Open in a Simple Browser tab, beside your code',
        buttons: [PIN_BUTTON],
    },
    {
        target: 'browser',
        label: '$(globe) Browser',
        detail: 'Open in your default browser, with real devtools',
        buttons: [PIN_BUTTON],
    },
];

/**
 * Ask where the preview should open.
 *
 * Picking an entry answers for this preview only. Answering for good is the pin
 * button, which is deliberately a separate gesture: a choice made once in a
 * quick pick should not quietly become permanent, because the prompt is then
 * gone and there is nothing left to suggest a setting was ever written.
 */
async function chooseTarget(): Promise<PreviewTarget | undefined> {
    const configuration = vscode.workspace.getConfiguration('axis');
    const configured = configuration.get<string>(TARGET_SETTING);
    if (configured === 'editor' || configured === 'browser') {
        return configured;
    }

    return new Promise<PreviewTarget | undefined>(resolve => {
        const pick = vscode.window.createQuickPick<TargetChoice>();
        pick.title = 'Open the Axis preview in';
        pick.placeholder = 'Pin a choice to make it the default';
        pick.items = CHOICES;

        pick.onDidTriggerItemButton(async event => {
            await configuration.update(
                TARGET_SETTING,
                event.item.target,
                vscode.ConfigurationTarget.Global,
            );
            pick.hide();
            resolve(event.item.target);
        });
        pick.onDidAccept(() => {
            const [picked] = pick.selectedItems;
            pick.hide();
            resolve(picked?.target);
        });
        // Also reached after an accept, where the promise has already settled.
        pick.onDidHide(() => {
            pick.dispose();
            resolve(undefined);
        });

        pick.show();
    });
}

/**
 * The address to hand a browser, as a string.
 *
 * `Uri` keeps its components decoded, so `toString(true)` is the readable form
 * rather than a valid URL. `encodeURI` is what escapes it - the same call
 * `openExternal` makes on the way out - so both targets are pointed at exactly
 * the same address rather than at two encodings of it.
 */
function addressOf(url: vscode.Uri): string {
    return encodeURI(url.toString(true));
}

/** Hand `url` to whichever browser the user asked for. */
async function show(target: PreviewTarget, url: vscode.Uri) {
    if (target === 'editor') {
        await vscode.commands.executeCommand(SIMPLE_BROWSER_COMMAND, addressOf(url));
    } else {
        await vscode.env.openExternal(url);
    }
}

/** Open a preview of `uri`, asking where to put it if there is no preference. */
export async function openPreview(server: PreviewServer, uri: vscode.Uri) {
    // A preview serves what is on disk. An unsaved buffer has nothing there to
    // serve, so this is a real answer rather than an empty graph.
    if (uri.scheme === 'untitled') {
        void vscode.window.showInformationMessage('Save the file before previewing it.');
        return;
    }

    const target = await chooseTarget();
    if (!target) {
        return;
    }

    let url: vscode.Uri;
    try {
        url = await server.previewUrl(uri);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Could not start the Axis preview server: ${message}`);
        return;
    }

    await show(target, url);
}

/** Reopen a file already being served, without asking anything twice. */
export async function reopenPreview(server: PreviewServer, uri: vscode.Uri) {
    const target = await chooseTarget();
    if (target) {
        await show(target, await server.previewUrl(uri));
    }
}

/** The `.axis` file a preview command should act on, if there is an obvious one. */
export async function resolvePreviewTarget(
    argument: unknown,
    isAxisDocument: (document: vscode.TextDocument) => boolean,
): Promise<vscode.Uri | undefined> {
    // Invoked from the editor title bar, VSCode passes the resource.
    if (argument instanceof vscode.Uri) {
        return argument;
    }

    const active = vscode.window.activeTextEditor?.document;
    if (active && isAxisDocument(active)) {
        return active.uri;
    }

    // From the palette with something else in front: offer what is open.
    const candidates = vscode.workspace.textDocuments.filter(isAxisDocument);
    if (candidates.length === 0) {
        void vscode.window.showInformationMessage('Open a .axis file to preview it.');
        return undefined;
    }
    if (candidates.length === 1) {
        return candidates[0].uri;
    }

    const picked = await vscode.window.showQuickPick(
        candidates.map(document => ({
            label: basename(document.uri),
            description: vscode.workspace.asRelativePath(document.uri),
            uri: document.uri,
        })),
        { title: 'Preview which Axis file?' },
    );
    return picked?.uri;
}
