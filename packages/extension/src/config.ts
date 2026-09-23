import * as vscode from 'vscode';
import { AXIS_DESMOS_API_KEY } from '@axis-dsl/desmos';

/**
 * The Desmos calculator loads from a URL carrying an API key.
 *
 * The Axis project's key is baked in so the extension works with no setup.
 * `axis.apiKey` exists so a user can supply their own - and so the preview
 * keeps working if that key is ever withdrawn.
 */
export function resolveDesmosApiKey(): string {
    const configured = vscode.workspace.getConfiguration('axis').get<string>('apiKey')?.trim();
    return configured || AXIS_DESMOS_API_KEY;
}

/**
 * Whether the preview page shows its tabs and the file it is showing.
 *
 * The page is a plain graph by default; a file is written in the editor and
 * looked at here, and the JSON behind it is a thing to reach for rather than a
 * thing to keep on screen.
 */
export function previewDebugEnabled(): boolean {
    return vscode.workspace.getConfiguration('axis').get<boolean>('preview.debug') ?? false;
}
