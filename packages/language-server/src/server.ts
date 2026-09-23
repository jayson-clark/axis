// ═════════════════════════════════════════════════════════════════════════════
// The server - the language service, spoken over LSP
// ═════════════════════════════════════════════════════════════════════════════
//
// Every answer comes from `@axis-dsl/language-service`, asked of a snapshot of
// the document (`programs.ts`) that already has its imports in hand. What is
// here is the part the service cannot do on its own because it never touches
// a file system: resolving and reading imports and images, listing a directory
// for a path completion, noticing that a file some document reads has changed,
// and saying which files are missing.

import {
    AXIS_IMAGE_EXTENSIONS,
    formatDocument,
    formatRange,
    getCompletions,
    getDefinition,
    getDiagnostics,
    getDocumentHighlights,
    getDocumentLinks,
    getDocumentSymbols,
    getFoldingRanges,
    getHover,
    getPathCompletions,
    getPathContext,
    getReferences,
    getSemanticTokens,
    missingImageDiagnostic,
    missingImportDiagnostic,
    SEMANTIC_TOKEN_LEGEND,
    type Diagnostic,
    type FormattingOptions,
    type Range,
} from '@axis-dsl/language-service';
import {
    DidChangeWatchedFilesNotification,
    MarkupKind,
    TextDocuments,
    TextDocumentSyncKind,
    type Connection,
    type DocumentLink,
    type InitializeParams,
    type InitializeResult,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    toCompletionItem,
    toDiagnostic,
    toDocumentSymbol,
    toFoldingRange,
    toHighlight,
} from './convert';
import { FileSystem } from './files';
import { normalizeUri, resolveDirectoryUri, resolveImageUri, resolveImportUri } from './paths';
import { Programs, type Snapshot } from './programs';

/** How long an edit sits before the document is checked again. */
const DEBOUNCE_MS = 250;

/**
 * What a client can tell the server at `initialize`, all optional - an editor
 * that says nothing gets every feature, as any LSP server would give it.
 */
export interface AxisInitializationOptions {
    /**
     * A client command that opens the completion list again, attached to a
     * directory completion so a path is completed a segment at a time. VSCode
     * has `editor.action.triggerSuggest`; an editor without one leaves it out
     * and gets no command.
     */
    retriggerCommand?: string;
}

/** The characters that open a context of their own: metadata, a property's value, a member, a path and its next segment. */
const TRIGGER_CHARACTERS = ['@', ':', '.', '"', '/'];

/** What the file watcher reports on: Axis files, and the pictures an `image` draws. */
const WATCHED_FILES = `**/*.{axis,${AXIS_IMAGE_EXTENSIONS.join(',')}}`;

/**
 * Serve Axis over `connection` until it closes. The connection is not yet
 * listening; this registers every handler and then starts it.
 */
export function listen(connection: Connection): void {
    const documents = new TextDocuments(TextDocument);
    const files = new FileSystem(documents);
    let roots: string[] = [];
    const programs = new Programs(files, () => roots);

    let retriggerCommand: string | undefined;
    let canConfigure = false;
    let canWatchFiles = false;
    let hasWorkspaceFolders = false;

    connection.onInitialize((params: InitializeParams): InitializeResult => {
        const { capabilities } = params;
        const options = (params.initializationOptions ?? {}) as AxisInitializationOptions;
        retriggerCommand = options.retriggerCommand;
        canConfigure = capabilities.workspace?.configuration === true;
        canWatchFiles = capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
        hasWorkspaceFolders = capabilities.workspace?.workspaceFolders === true;

        roots = (
            params.workspaceFolders?.map(folder => folder.uri) ??
            (params.rootUri ? [params.rootUri] : [])
        ).map(normalizeUri);

        return {
            capabilities: {
                textDocumentSync: {
                    openClose: true,
                    change: TextDocumentSyncKind.Full,
                    // A save re-checks what imports the saved file.
                    save: { includeText: false },
                },
                completionProvider: { triggerCharacters: TRIGGER_CHARACTERS },
                hoverProvider: true,
                documentFormattingProvider: true,
                documentRangeFormattingProvider: true,
                semanticTokensProvider: {
                    legend: SEMANTIC_TOKEN_LEGEND,
                    full: true,
                    range: true,
                },
                documentLinkProvider: { resolveProvider: false },
                definitionProvider: true,
                referencesProvider: true,
                documentHighlightProvider: true,
                documentSymbolProvider: true,
                foldingRangeProvider: true,
                workspace: {
                    workspaceFolders: { supported: true, changeNotifications: true },
                },
            },
            serverInfo: { name: 'axis-language-server' },
        };
    });

    connection.onInitialized(() => {
        // Registered rather than left to the client, so every editor watches
        // the same files without being told which.
        if (canWatchFiles) {
            void connection.client.register(DidChangeWatchedFilesNotification.type, {
                watchers: [{ globPattern: WATCHED_FILES }],
            });
        }
        if (hasWorkspaceFolders) {
            connection.workspace.onDidChangeWorkspaceFolders(event => {
                const removed = new Set(event.removed.map(folder => normalizeUri(folder.uri)));
                roots = [
                    ...roots.filter(root => !removed.has(root)),
                    ...event.added.map(folder => normalizeUri(folder.uri)),
                ];
                // A leading `/` may now mean somewhere else.
                recheckAll();
            });
        }
    });

    // ── Diagnostics ─────────────────────────────────────────────────────────

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    /** The latest check started for each document, so an older one finishing late is dropped. */
    const checks = new Map<string, number>();
    let checkCount = 0;

    const schedule = (uri: string, delay = DEBOUNCE_MS) => {
        clearTimeout(timers.get(uri));
        timers.set(
            uri,
            setTimeout(() => {
                timers.delete(uri);
                void check(uri);
            }, delay),
        );
    };

    async function check(uri: string): Promise<void> {
        const document = documents.get(uri);
        if (!document) return;
        const id = ++checkCount;
        checks.set(uri, id);

        const snapshot = await programs.get(document);
        if (checks.get(uri) !== id || documents.get(uri)?.version !== snapshot.version) return;

        await connection.sendDiagnostics({
            uri,
            version: snapshot.version,
            diagnostics: diagnose(snapshot).map(toDiagnostic),
        });
    }

    /** Check again every open document that reads `uri`, which has changed. */
    async function recheckDependents(uri: string): Promise<void> {
        for (const dependent of await programs.dependents(uri)) {
            if (dependent === uri) continue;
            programs.invalidate(dependent);
            schedule(dependent);
        }
    }

    function recheckAll(): void {
        for (const document of documents.all()) {
            programs.invalidate(document.uri);
            schedule(document.uri, 0);
        }
    }

    // Opening a document fires both events, the open first. It is checked at
    // once - there is no typing to wait out - and the change that follows it
    // is not a reason to wait after all.
    const opening = new Set<string>();
    documents.onDidOpen(event => {
        opening.add(event.document.uri);
        schedule(event.document.uri, 0);
    });
    documents.onDidChangeContent(event => {
        const { uri } = event.document;
        if (!opening.delete(uri)) {
            schedule(uri);
        }
        // An open document is read in place of its file, so what imports it
        // sees the edit as it is typed.
        void recheckDependents(uri);
    });
    documents.onDidSave(event => void recheckDependents(event.document.uri));
    documents.onDidClose(event => {
        const { uri } = event.document;
        clearTimeout(timers.get(uri));
        timers.delete(uri);
        checks.delete(uri);
        opening.delete(uri);
        // Found before the snapshot is dropped: closing hands what imports this
        // document back to the file on disk, which may say something else.
        void recheckDependents(uri).then(() => programs.invalidate(uri));
        void connection.sendDiagnostics({ uri, diagnostics: [] });
    });

    connection.onDidChangeWatchedFiles(async params => {
        for (const change of params.changes) {
            await recheckDependents(change.uri);
        }
    });

    // ── Requests ────────────────────────────────────────────────────────────

    /** The current snapshot of an open document, or undefined for one the client never opened. */
    const snapshotOf = (uri: string): Promise<Snapshot> | undefined => {
        const document = documents.get(uri);
        return document && programs.get(document);
    };

    connection.onCompletion(async ({ textDocument, position }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        if (!snapshot) return [];

        // A path is the one completion that has to ask the file system, and
        // that asking is asynchronous, so it is done here rather than through
        // the service's synchronous `listDirectory`.
        const path = getPathContext(snapshot.tree, position);
        if (path) {
            const directory = resolveDirectoryUri(textDocument.uri, path.directory, roots);
            const entries = await files.listDirectory(directory);
            return getPathCompletions(path, entries).map((item, index) =>
                // Ordered as the service listed them - folders first - rather
                // than alphabetically by label, as a client would otherwise.
                toCompletionItem(
                    { ...item, sortText: String(index).padStart(4, '0') },
                    retriggerCommand,
                ),
            );
        }

        return getCompletions(snapshot.tree, position, snapshot.options).map(item =>
            toCompletionItem(item, retriggerCommand),
        );
    });

    connection.onHover(async ({ textDocument, position }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        const hover = snapshot && getHover(snapshot.tree, position, snapshot.options);
        return hover
            ? { contents: { kind: MarkupKind.Markdown, value: hover.contents }, range: hover.range }
            : null;
    });

    /**
     * The editor's formatting options, plus the column Axis breaks a long line
     * at: `axis.format.maxLineLength`, read from the client's settings where it
     * has any. Not `editor.wordWrapColumn`, which decides where a line is
     * displayed folded and says nothing about where it should be written.
     */
    async function formattingOptions(
        uri: string,
        options: { tabSize: number; insertSpaces: boolean },
    ): Promise<FormattingOptions> {
        let maxLineLength: number | undefined;
        if (canConfigure) {
            const settings = (await connection.workspace.getConfiguration({
                scopeUri: uri,
                section: 'axis',
            })) as { format?: { maxLineLength?: unknown } } | null;
            const configured = settings?.format?.maxLineLength;
            if (typeof configured === 'number') maxLineLength = configured;
        }
        return { tabSize: options.tabSize, insertSpaces: options.insertSpaces, maxLineLength };
    }

    connection.onDocumentFormatting(async ({ textDocument, options }) => {
        const document = documents.get(textDocument.uri);
        if (!document) return [];
        return formatDocument(
            document.getText(),
            await formattingOptions(textDocument.uri, options),
        );
    });

    connection.onDocumentRangeFormatting(async ({ textDocument, range, options }) => {
        const document = documents.get(textDocument.uri);
        if (!document) return [];
        return formatRange(
            document.getText(),
            range,
            await formattingOptions(textDocument.uri, options),
        );
    });

    connection.languages.semanticTokens.on(async ({ textDocument }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        return snapshot ? getSemanticTokens(snapshot.tree, snapshot.options) : { data: [] };
    });

    connection.languages.semanticTokens.onRange(async ({ textDocument, range }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        return snapshot
            ? getSemanticTokens(snapshot.tree, { ...snapshot.options, range })
            : { data: [] };
    });

    /**
     * Ctrl-click on the path in an `import` or an `image`, resolved the way
     * that statement resolves one. Nothing asks whether the file is there: a
     * missing one is already an error on the same range.
     */
    connection.onDocumentLinks(async ({ textDocument }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        if (!snapshot) return [];
        return getDocumentLinks(snapshot.tree).map((link): DocumentLink => ({
            range: link.range,
            target:
                link.kind === 'import'
                    ? resolveImportUri(textDocument.uri, link.target, roots)
                    : link.kind === 'image'
                      ? resolveImageUri(textDocument.uri, link.target, roots)
                      : link.target,
            tooltip: link.kind === 'url' ? undefined : `Open ${link.target}`,
        }));
    });

    connection.onDefinition(async ({ textDocument, position }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        if (!snapshot) return [];
        // A name an import defines is found in the file the resolver read it
        // from, which is named by URI - so it opens as it is.
        return getDefinition(snapshot.tree, position, snapshot.options).map(location => ({
            uri: location.uri ?? textDocument.uri,
            range: location.range,
        }));
    });

    connection.onReferences(async ({ textDocument, position, context }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        if (!snapshot) return [];
        return getReferences(snapshot.tree, position, {
            includeDeclaration: context.includeDeclaration,
        }).map(range => ({ uri: textDocument.uri, range }));
    });

    connection.onDocumentHighlight(async ({ textDocument, position }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        return snapshot ? getDocumentHighlights(snapshot.tree, position).map(toHighlight) : [];
    });

    connection.onDocumentSymbol(async ({ textDocument }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        return snapshot ? getDocumentSymbols(snapshot.tree).map(toDocumentSymbol) : [];
    });

    connection.onFoldingRanges(async ({ textDocument }) => {
        const snapshot = await snapshotOf(textDocument.uri);
        return snapshot ? getFoldingRanges(snapshot.tree).map(toFoldingRange) : [];
    });

    connection.onShutdown(() => {
        timers.forEach(timer => clearTimeout(timer));
        timers.clear();
    });

    documents.listen(connection);
    connection.listen();
}

/**
 * Everything wrong with a document: the parser's and the compiler's, with the
 * compiler's word for an import or image it could not resolve replaced by the
 * plainer "Cannot find", on the path itself rather than its quotes. Those are
 * the diagnostics only a host with a file system can give - the compiler
 * reports `from file:///…/main.axis` because it knows no better.
 */
export function diagnose(snapshot: Snapshot): Diagnostic[] {
    const { tree, options } = snapshot;
    const links = getDocumentLinks(tree);
    return getDiagnostics(tree, options).map(diagnostic => {
        const missing =
            diagnostic.code === 'unresolved-import'
                ? missingImportDiagnostic
                : diagnostic.code === 'unresolved-image'
                  ? missingImageDiagnostic
                  : undefined;
        const link = missing && links.find(link => contains(diagnostic.range, link.range));
        return missing && link ? missing(tree, link) : diagnostic;
    });
}

const contains = (outer: Range, inner: Range) =>
    !before(inner.start, outer.start) && !before(outer.end, inner.end);

const before = (a: Range['start'], b: Range['start']) =>
    a.line < b.line || (a.line === b.line && a.character < b.character);
