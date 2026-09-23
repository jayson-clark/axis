// ═════════════════════════════════════════════════════════════════════════════
// Conversions - the language service's shapes into LSP's
// ═════════════════════════════════════════════════════════════════════════════
//
// Positions and ranges need none: the service counts zero-based lines and
// UTF-16 characters, which is what LSP counts too. Everything else is an enum
// mapped or a field renamed, and nothing about the language is decided here.

import type * as service from '@axis-dsl/language-service';
import {
    CompletionItemKind,
    DiagnosticSeverity,
    DocumentHighlightKind,
    FoldingRangeKind,
    InsertTextFormat,
    MarkupKind,
    SymbolKind,
    type CompletionItem,
    type Diagnostic,
    type DocumentHighlight,
    type DocumentSymbol,
    type FoldingRange,
} from 'vscode-languageserver';

const SEVERITIES: Record<service.DiagnosticSeverity, DiagnosticSeverity> = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    info: DiagnosticSeverity.Information,
};

export function toDiagnostic(diagnostic: service.Diagnostic): Diagnostic {
    return {
        range: diagnostic.range,
        severity: SEVERITIES[diagnostic.severity],
        code: diagnostic.code,
        source: diagnostic.source,
        message: diagnostic.message,
    };
}

const COMPLETION_KINDS: Record<service.CompletionKind, CompletionItemKind> = {
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
    file: CompletionItemKind.File,
    folder: CompletionItemKind.Folder,
};

/**
 * One completion item. `retrigger` - a directory, mid-path - becomes the
 * command that opens the list again, but only for a client that said it has
 * one by that name: the command is VSCode's, and any other editor would send
 * it back to the server as an `executeCommand` it cannot answer.
 */
export function toCompletionItem(
    item: service.CompletionItem,
    retriggerCommand: string | undefined,
): CompletionItem {
    const newText = item.snippet ?? item.label;
    return {
        label: item.label,
        kind: COMPLETION_KINDS[item.kind],
        detail: item.detail,
        documentation: item.documentation
            ? { kind: MarkupKind.Markdown, value: item.documentation }
            : undefined,
        sortText: item.sortText,
        insertTextFormat: item.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
        // A range, so a path completion replaces the segment being typed
        // rather than the word the client would find, which stops at `/`.
        ...(item.range ? { textEdit: { range: item.range, newText } } : { insertText: newText }),
        command:
            item.retrigger && retriggerCommand
                ? { command: retriggerCommand, title: 'Suggest' }
                : undefined,
    };
}

export function toHighlight(highlight: service.DocumentHighlight): DocumentHighlight {
    return {
        range: highlight.range,
        kind: highlight.kind === 'write' ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
    };
}

const SYMBOL_KINDS: Record<service.DocumentSymbolKind, SymbolKind> = {
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

export function toDocumentSymbol(symbol: service.DocumentSymbol): DocumentSymbol {
    return {
        name: symbol.name,
        detail: symbol.detail,
        kind: SYMBOL_KINDS[symbol.kind],
        range: symbol.range,
        selectionRange: symbol.selectionRange,
        children: symbol.children?.map(toDocumentSymbol),
    };
}

export function toFoldingRange(range: service.FoldingRange): FoldingRange {
    return {
        startLine: range.startLine,
        endLine: range.endLine,
        kind: range.kind === 'comment' ? FoldingRangeKind.Comment : undefined,
    };
}
