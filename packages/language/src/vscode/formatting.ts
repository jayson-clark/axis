import * as vscode from 'vscode';
import { formatAxisCode, formatAxisCodeWithIndent, indentLevelOf } from '../index';

export class AxisFormattingProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        _token: vscode.CancellationToken,
    ): vscode.TextEdit[] {
        const text = document.getText();
        const formatted = formatAxisCode(text, options);

        if (formatted === text) {
            return [];
        }

        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(text.length),
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
    }
}

export class AxisRangeFormattingProvider implements vscode.DocumentRangeFormattingEditProvider {
    provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        _token: vscode.CancellationToken,
    ): vscode.TextEdit[] {
        // Formatting works line-wise, so widen a partial selection to whole lines.
        const startLine = document.lineAt(range.start.line);
        const endLine = document.lineAt(range.end.line);
        const fullRange = new vscode.Range(startLine.range.start, endLine.range.end);

        const text = document.getText(fullRange);
        const formatted = formatAxisCodeWithIndent(
            text,
            options,
            indentLevelOf(startLine.text, options),
        );

        return formatted === text ? [] : [vscode.TextEdit.replace(fullRange, formatted)];
    }
}
