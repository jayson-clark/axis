// ═════════════════════════════════════════════════════════════════════════════
// Completions - Monaco suggestions
// ═════════════════════════════════════════════════════════════════════════════

import type * as monaco from 'monaco-editor/editor';
import { AxisCompletionKind, AXIS_LANGUAGE_ID, getAxisCompletions } from '../index';
import type { MonacoApi } from './types';

function completionKinds(
    api: MonacoApi,
): Record<AxisCompletionKind, monaco.languages.CompletionItemKind> {
    const { CompletionItemKind } = api.languages;
    return {
        function: CompletionItemKind.Function,
        constant: CompletionItemKind.Constant,
        keyword: CompletionItemKind.Keyword,
        property: CompletionItemKind.Property,
        variable: CompletionItemKind.Variable,
        // No host in a browser has files to name, so these two never arrive -
        // but the map is total, so the compiler says so if that ever changes.
        file: CompletionItemKind.File,
        folder: CompletionItemKind.Folder,
    };
}

/** Register the Axis completion provider on `api`. */
export function registerAxisCompletions(api: MonacoApi): monaco.IDisposable {
    const kinds = completionKinds(api);
    const insertAsSnippet = api.languages.CompletionItemInsertTextRule.InsertAsSnippet;

    return api.languages.registerCompletionItemProvider(AXIS_LANGUAGE_ID, {
        triggerCharacters: ['.', '(', '#'],
        provideCompletionItems(model, position) {
            // Monaco positions are 1-based; the core service is 0-based.
            const items = getAxisCompletions(model.getValue(), {
                line: position.lineNumber - 1,
                character: position.column - 1,
            });

            const word = model.getWordUntilPosition(position);
            const range: monaco.IRange = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            return {
                suggestions: items.map(item => ({
                    label: item.label,
                    kind: kinds[item.kind],
                    detail: item.detail,
                    insertText: item.snippet ?? item.label,
                    insertTextRules: item.snippet ? insertAsSnippet : undefined,
                    range,
                })),
            };
        },
    });
}
