// A client for the suites: the built `axis-language-server` bin started over
// stdio, exactly as an editor starts it, with a JSON-RPC connection to it and
// the diagnostics it publishes collected as they arrive.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    createMessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
    type MessageConnection,
} from 'vscode-jsonrpc/node';
import {
    DidChangeTextDocumentNotification,
    DidChangeWatchedFilesNotification,
    DidOpenTextDocumentNotification,
    ExitNotification,
    InitializedNotification,
    InitializeRequest,
    PublishDiagnosticsNotification,
    RegistrationRequest,
    ShutdownRequest,
    type ClientCapabilities,
    type Diagnostic,
    type FileEvent,
    type InitializeResult,
    type Position,
    type PublishDiagnosticsParams,
} from 'vscode-languageserver';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

/** Everything a client says it can do that the server looks for. */
const CAPABILITIES: ClientCapabilities = {
    workspace: {
        configuration: true,
        workspaceFolders: true,
        didChangeWatchedFiles: { dynamicRegistration: true },
    },
    textDocument: {
        completion: { completionItem: { snippetSupport: true } },
        hover: { contentFormat: ['markdown'] },
    },
};

export interface Client {
    connection: MessageConnection;
    initialize: InitializeResult;
    /** Glob patterns the server asked the client to watch. */
    watchers: string[];
    /** Settles once the server has registered its file watcher, which it does after `initialized`. */
    registered: Promise<void>;
    /** Open a document; its diagnostics arrive with {@link diagnostics}. */
    open(uri: string, text: string): Promise<void>;
    change(uri: string, version: number, text: string): Promise<void>;
    filesChanged(changes: FileEvent[]): Promise<void>;
    /**
     * The next diagnostics published for `uri` that satisfy `until` - by
     * default, the first set to arrive after the call.
     */
    diagnostics(uri: string, until?: (diagnostics: Diagnostic[]) => boolean): Promise<Diagnostic[]>;
    close(): Promise<void>;
}

/** Start the server and initialize it, with `root` as the workspace folder if one is given. */
export async function startClient(
    options: {
        root?: string;
        /** The server to start: the package's own bin by default, or a bundle of it. */
        server?: string;
        settings?: Record<string, unknown>;
        initializationOptions?: unknown;
    } = {},
): Promise<Client> {
    const child: ChildProcess = spawn(process.execPath, [options.server ?? BIN, '--stdio'], {
        stdio: ['pipe', 'pipe', 'inherit'],
    });
    const connection = createMessageConnection(
        new StreamMessageReader(child.stdout!),
        new StreamMessageWriter(child.stdin!),
    );

    const waiting: {
        uri: string;
        until: (diagnostics: Diagnostic[]) => boolean;
        resolve: (diagnostics: Diagnostic[]) => void;
    }[] = [];
    connection.onNotification(
        PublishDiagnosticsNotification.type,
        (params: PublishDiagnosticsParams) => {
            for (const waiter of [...waiting]) {
                if (waiter.uri === params.uri && waiter.until(params.diagnostics)) {
                    waiting.splice(waiting.indexOf(waiter), 1);
                    waiter.resolve(params.diagnostics);
                }
            }
        },
    );

    const watchers: string[] = [];
    let onRegistered!: () => void;
    const registered = new Promise<void>(resolve => (onRegistered = resolve));
    connection.onRequest(RegistrationRequest.type, params => {
        for (const registration of params.registrations) {
            if (registration.method === DidChangeWatchedFilesNotification.method) {
                for (const watcher of registration.registerOptions.watchers) {
                    watchers.push(String(watcher.globPattern));
                }
                onRegistered();
            }
        }
    });
    connection.onRequest('workspace/configuration', (params: { items: unknown[] }) =>
        params.items.map(() => options.settings ?? null),
    );
    connection.listen();

    const rootUri = options.root ? pathToFileURL(options.root).href : null;
    const initialize = await connection.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri,
        workspaceFolders: rootUri ? [{ uri: rootUri, name: 'root' }] : null,
        capabilities: CAPABILITIES,
        initializationOptions: options.initializationOptions,
    });
    await connection.sendNotification(InitializedNotification.type, {});

    return {
        connection,
        initialize,
        watchers,
        registered,
        open: (uri, text) =>
            connection.sendNotification(DidOpenTextDocumentNotification.type, {
                textDocument: { uri, languageId: 'axis', version: 1, text },
            }),
        change: (uri, version, text) =>
            connection.sendNotification(DidChangeTextDocumentNotification.type, {
                textDocument: { uri, version },
                contentChanges: [{ text }],
            }),
        filesChanged: changes =>
            connection.sendNotification(DidChangeWatchedFilesNotification.type, { changes }),
        diagnostics: (uri, until = () => true) =>
            new Promise(resolve => waiting.push({ uri, until, resolve })),
        async close() {
            await connection.sendRequest(ShutdownRequest.type);
            await connection.sendNotification(ExitNotification.type);
            connection.dispose();
            await new Promise(resolve =>
                child.exitCode === null ? child.once('exit', resolve) : resolve(undefined),
            );
        },
    };
}

/** A temporary directory of files, as `{ 'lib/a.axis': '…' }`, removed by `dispose`. */
export function tempWorkspace(files: Record<string, string>) {
    // Real path: macOS hands out /var/…, which is a link to /private/var/….
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'axis-language-server-')));
    const write = (path: string, text: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    };
    for (const [path, text] of Object.entries(files)) write(path, text);
    return {
        root,
        uri: (path: string) => pathToFileURL(join(root, path)).href,
        write,
        dispose: () => rmSync(root, { recursive: true, force: true }),
    };
}

/** The position of the first `needle` in `source`, `delta` characters into it. */
export function positionOf(source: string, needle: string, delta = 0): Position {
    const at = source.indexOf(needle);
    if (at < 0) throw new Error(`${needle} not in source`);
    const before = source.slice(0, at + delta).split('\n');
    return { line: before.length - 1, character: before.at(-1)!.length };
}
