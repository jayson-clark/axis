import * as vscode from 'vscode';
import {
    AxisCompletionItem,
    AxisCompletionKind,
    AxisPathContext,
    axisPathCompletions,
    axisPathContext,
    getAxisCompletions,
} from '../index';
import { readDirectory, resolveDirectoryUri } from './imports';

const KIND_MAP: Record<AxisCompletionKind, vscode.CompletionItemKind> = {
    function: vscode.CompletionItemKind.Function,
    constant: vscode.CompletionItemKind.Constant,
    keyword: vscode.CompletionItemKind.Keyword,
    property: vscode.CompletionItemKind.Property,
    variable: vscode.CompletionItemKind.Variable,
    file: vscode.CompletionItemKind.File,
    folder: vscode.CompletionItemKind.Folder,
};

/** Retriggering after a directory is what completes a path a segment at a time. */
const TRIGGER_SUGGEST: vscode.Command = {
    command: 'editor.action.triggerSuggest',
    title: 'Suggest',
};

function toVscodeCompletion(item: AxisCompletionItem): vscode.CompletionItem {
    const completion = new vscode.CompletionItem(item.label, KIND_MAP[item.kind]);
    completion.detail = item.detail;
    if (item.snippet) {
        completion.insertText = new vscode.SnippetString(item.snippet);
    }
    return completion;
}

/**
 * One entry of the directory an `import` or an `image` is naming.
 *
 * The range is the segment being typed rather than the word VSCode would find
 * for itself, which stops at the `/` and at the `.` of an extension - so
 * accepting `curves.axis` after `./cur` would otherwise leave `./curves.curves`.
 * Directories are offered first and reopen the list, since the path goes on.
 */
function toPathCompletion(
    context: AxisPathContext,
    item: AxisCompletionItem,
    index: number,
): vscode.CompletionItem {
    const completion = toVscodeCompletion(item);
    completion.range = new vscode.Range(
        context.line,
        context.startCharacter,
        context.line,
        context.endCharacter,
    );
    // Ordered as the language listed them, not alphabetically by label.
    completion.sortText = String(index).padStart(4, '0');

    if (item.kind === 'folder') {
        completion.command = TRIGGER_SUGGEST;
    }

    return completion;
}

export class AxisCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext,
    ): Promise<vscode.CompletionItem[]> {
        const text = document.getText();
        const where = { line: position.line, character: position.character };

        // A path is the one completion that has to ask the filesystem, and the
        // only one the language cannot answer by itself.
        const path = axisPathContext(text, where);
        if (path) {
            const directory = resolveDirectoryUri(document.uri, path.directory);
            const entries = await readDirectory(directory);
            return axisPathCompletions(path, entries).map((item, index) =>
                toPathCompletion(path, item, index),
            );
        }

        return getAxisCompletions(text, where).map(toVscodeCompletion);
    }
}
