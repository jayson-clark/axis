import * as vscode from 'vscode';
import { AXIS_LANGUAGE_ID } from '../index';
import { AxisCompletionProvider } from './completions';
import { AxisFormattingProvider, AxisRangeFormattingProvider } from './formatting';
import { registerAxisDiagnostics } from './diagnostics';

/**
 * Register every Axis language provider. Returns the disposables so the caller
 * can push them onto its extension subscriptions.
 */
export function registerAxisLanguage(): vscode.Disposable[] {
    const selector: vscode.DocumentSelector = { language: AXIS_LANGUAGE_ID, scheme: 'file' };

    return [
        vscode.languages.registerCompletionItemProvider(
            selector,
            new AxisCompletionProvider(),
            '.',
            '(',
            '#',
        ),
        vscode.languages.registerDocumentFormattingEditProvider(
            selector,
            new AxisFormattingProvider(),
        ),
        vscode.languages.registerDocumentRangeFormattingEditProvider(
            selector,
            new AxisRangeFormattingProvider(),
        ),
        // Diagnostics work off the documents themselves, so they cover untitled
        // and in-memory buffers that the `file`-scheme selector above misses.
        ...registerAxisDiagnostics(),
    ];
}
