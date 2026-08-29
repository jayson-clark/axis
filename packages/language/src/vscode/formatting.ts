import * as vscode from 'vscode';
import {
    AxisFormattingOptions,
    formatAxisCode,
    formatAxisCodeWithIndent,
    indentLevelOf,
} from '../index';

/**
 * The editor's formatting options, plus the column Axis wraps a long line at.
 *
 * The wrap column is Axis' own setting rather than `editor.wordWrapColumn`,
 * which decides where a long line is *displayed* folded and says nothing about
 * where it should be written.
 */
function formattingOptionsFor(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
): AxisFormattingOptions {
    return {
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
        maxLineLength: vscode.workspace
            .getConfiguration('axis', document)
            .get<number>('format.maxLineLength'),
    };
}

export class AxisFormattingProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        _token: vscode.CancellationToken,
    ): vscode.TextEdit[] {
        const text = document.getText();
        const formatted = formatAxisCode(text, formattingOptionsFor(document, options));

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
        const axisOptions = formattingOptionsFor(document, options);
        const formatted = formatAxisCodeWithIndent(
            text,
            axisOptions,
            indentLevelOf(startLine.text, axisOptions),
        );

        return formatted === text ? [] : [vscode.TextEdit.replace(fullRange, formatted)];
    }
}
