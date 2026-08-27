import * as vscode from 'vscode';
import { AxisCompletionItem, AxisCompletionKind, getAxisCompletions } from '../index';

const KIND_MAP: Record<AxisCompletionKind, vscode.CompletionItemKind> = {
    function: vscode.CompletionItemKind.Function,
    constant: vscode.CompletionItemKind.Constant,
    keyword: vscode.CompletionItemKind.Keyword,
    property: vscode.CompletionItemKind.Property,
    variable: vscode.CompletionItemKind.Variable,
};

function toVscodeCompletion(item: AxisCompletionItem): vscode.CompletionItem {
    const completion = new vscode.CompletionItem(item.label, KIND_MAP[item.kind]);
    completion.detail = item.detail;
    if (item.snippet) {
        completion.insertText = new vscode.SnippetString(item.snippet);
    }
    return completion;
}

export class AxisCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext,
    ): vscode.CompletionItem[] {
        return getAxisCompletions(document.getText(), {
            line: position.line,
            character: position.character,
        }).map(toVscodeCompletion);
    }
}
