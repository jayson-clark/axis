// ═════════════════════════════════════════════════════════════════════════════
// Monaco providers
// ═════════════════════════════════════════════════════════════════════════════
//
// Each one a thin translation: Monaco's model and position in, the service's
// answer out in Monaco's shapes. Nothing about the language is decided here.

import type * as monaco from 'monaco-editor/editor';
import { getCompletions, type CompletionKind } from '../completions';
import { formatDocument, formatRange, type FormattingOptions } from '../format';
import { getHover } from '../hover';
import { AXIS_LANGUAGE_ID } from '../language';
import {
    getDefinition,
    getDocumentHighlights,
    getDocumentSymbols,
    getFoldingRanges,
    getReferences,
    type DocumentSymbol,
    type DocumentSymbolKind,
} from '../navigation';
import { getSemanticTokens, SEMANTIC_TOKEN_LEGEND } from '../semantic-tokens';
import { toMonacoRange, toPosition, toRange, treeOf } from './convert';
import type { MonacoApi } from './themes';

function completionKinds(
    api: MonacoApi,
): Record<CompletionKind, monaco.languages.CompletionItemKind> {
    const { CompletionItemKind } = api.languages;
    return {
        keyword: CompletionItemKind.Keyword,
        function: CompletionItemKind.Function,
        constant: CompletionItemKind.Constant,
        variable: CompletionItemKind.Variable,
        parameter: CompletionItemKind.Variable,
        property: CompletionItemKind.Property,
        enumMember: CompletionItemKind.EnumMember,
        color: CompletionItemKind.Color,
        macro: CompletionItemKind.Snippet,
        style: CompletionItemKind.Class,
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
        // What opens a context of its own: metadata, a property's value, a
        // member, a path and its next segment.
        triggerCharacters: ['@', ':', '.', '"', '/'],
        provideCompletionItems(model, position) {
            const items = getCompletions(treeOf(model), toPosition(position));
            const word = model.getWordUntilPosition(position);
            const fallback: monaco.IRange = {
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
                    documentation: item.documentation ? { value: item.documentation } : undefined,
                    insertText: item.snippet ?? item.label,
                    insertTextRules: item.snippet ? insertAsSnippet : undefined,
                    range: item.range ? toMonacoRange(item.range) : fallback,
                    sortText: item.sortText,
                    command: item.retrigger
                        ? { id: 'editor.action.triggerSuggest', title: 'Suggest' }
                        : undefined,
                })),
            };
        },
    });
}

export function registerAxisHover(api: MonacoApi): monaco.IDisposable {
    return api.languages.registerHoverProvider(AXIS_LANGUAGE_ID, {
        provideHover(model, position) {
            const hover = getHover(treeOf(model), toPosition(position));
            return (
                hover && {
                    contents: [{ value: hover.contents }],
                    range: toMonacoRange(hover.range),
                }
            );
        },
    });
}

function formattingOptions(options: monaco.languages.FormattingOptions): FormattingOptions {
    return { tabSize: options.tabSize, insertSpaces: options.insertSpaces };
}

/** Register the Axis document and range formatters on `api`. */
export function registerAxisFormatting(api: MonacoApi): monaco.IDisposable {
    const edits = (list: { range: Parameters<typeof toMonacoRange>[0]; newText: string }[]) =>
        list.map(edit => ({ range: toMonacoRange(edit.range), text: edit.newText }));

    const document = api.languages.registerDocumentFormattingEditProvider(AXIS_LANGUAGE_ID, {
        provideDocumentFormattingEdits(model, options) {
            return edits(formatDocument(model.getValue(), formattingOptions(options)));
        },
    });
    const range = api.languages.registerDocumentRangeFormattingEditProvider(AXIS_LANGUAGE_ID, {
        provideDocumentRangeFormattingEdits(model, selection, options) {
            return edits(
                formatRange(model.getValue(), toRange(selection), formattingOptions(options)),
            );
        },
    });
    return {
        dispose() {
            document.dispose();
            range.dispose();
        },
    };
}

export function registerAxisSemanticTokens(api: MonacoApi): monaco.IDisposable {
    return api.languages.registerDocumentSemanticTokensProvider(AXIS_LANGUAGE_ID, {
        getLegend: () => SEMANTIC_TOKEN_LEGEND,
        provideDocumentSemanticTokens(model) {
            return { data: new Uint32Array(getSemanticTokens(treeOf(model)).data) };
        },
        releaseDocumentSemanticTokens() {},
    });
}

/** Go to definition, find references and highlights - all within the one model. */
export function registerAxisNavigation(api: MonacoApi): monaco.IDisposable {
    const disposables = [
        api.languages.registerDefinitionProvider(AXIS_LANGUAGE_ID, {
            provideDefinition(model, position) {
                return getDefinition(treeOf(model), toPosition(position)).map(location => ({
                    uri: location.uri ? api.Uri.parse(location.uri) : model.uri,
                    range: toMonacoRange(location.range),
                }));
            },
        }),
        api.languages.registerReferenceProvider(AXIS_LANGUAGE_ID, {
            provideReferences(model, position, context) {
                return getReferences(treeOf(model), toPosition(position), {
                    includeDeclaration: context.includeDeclaration,
                }).map(range => ({ uri: model.uri, range: toMonacoRange(range) }));
            },
        }),
        api.languages.registerDocumentHighlightProvider(AXIS_LANGUAGE_ID, {
            provideDocumentHighlights(model, position) {
                const { Read, Write } = api.languages.DocumentHighlightKind;
                return getDocumentHighlights(treeOf(model), toPosition(position)).map(
                    highlight => ({
                        range: toMonacoRange(highlight.range),
                        kind: highlight.kind === 'write' ? Write : Read,
                    }),
                );
            },
        }),
        api.languages.registerDocumentSymbolProvider(AXIS_LANGUAGE_ID, {
            provideDocumentSymbols(model) {
                return getDocumentSymbols(treeOf(model)).map(symbol => toMonacoSymbol(api, symbol));
            },
        }),
        api.languages.registerFoldingRangeProvider(AXIS_LANGUAGE_ID, {
            provideFoldingRanges(model) {
                return getFoldingRanges(treeOf(model)).map(range => ({
                    start: range.startLine + 1,
                    end: range.endLine + 1,
                    kind:
                        range.kind === 'comment'
                            ? api.languages.FoldingRangeKind.Comment
                            : undefined,
                }));
            },
        }),
    ];
    return { dispose: () => disposables.forEach(disposable => disposable.dispose()) };
}

function toMonacoSymbol(api: MonacoApi, symbol: DocumentSymbol): monaco.languages.DocumentSymbol {
    const { SymbolKind } = api.languages;
    const kinds: Record<DocumentSymbolKind, monaco.languages.SymbolKind> = {
        folder: SymbolKind.Namespace,
        table: SymbolKind.Array,
        config: SymbolKind.Object,
        style: SymbolKind.Class,
        macro: SymbolKind.Constant,
        import: SymbolKind.Module,
        image: SymbolKind.File,
        ticker: SymbolKind.Event,
        note: SymbolKind.String,
        variable: SymbolKind.Variable,
        function: SymbolKind.Function,
        property: SymbolKind.Property,
    };
    return {
        name: symbol.name,
        detail: symbol.detail ?? '',
        kind: kinds[symbol.kind],
        tags: [],
        range: toMonacoRange(symbol.range),
        selectionRange: toMonacoRange(symbol.selectionRange),
        children: symbol.children?.map(child => toMonacoSymbol(api, child)),
    };
}
