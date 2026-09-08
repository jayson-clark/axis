import * as vscode from 'vscode';
import { DESMOS_DEMO_API_KEY } from '@axis-dsl/desmos';

/**
 * The Desmos calculator loads from a URL carrying an API key.
 *
 * The demo key is baked in so the extension works with no setup: the script
 * runs client-side on the user's own machine, which is the prototyping case
 * Desmos publishes that key for. `axis.apiKey` exists so a user can supply
 * their own — and so the extension keeps working if Desmos ever restricts the
 * shared one.
 */
export function resolveDesmosApiKey(): string {
    const configured = vscode.workspace.getConfiguration('axis').get<string>('apiKey')?.trim();
    return configured || DESMOS_DEMO_API_KEY;
}

/**
 * Whether the preview page shows its tabs and the file it is showing.
 *
 * The page is a plain graph by default; a script is written in the editor and
 * looked at here, and the JSON behind it is a thing to reach for rather than a
 * thing to keep on screen.
 */
export function previewDebugEnabled(): boolean {
    return vscode.workspace.getConfiguration('axis').get<boolean>('preview.debug') ?? false;
}
