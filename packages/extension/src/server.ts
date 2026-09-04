import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import {
    compileAxis,
    createImageResolver,
    createImportResolver,
    loadImages,
    loadImports,
} from '@axis-dsl/compiler';
import { AXIS_FILE_EXTENSION } from '@axis-dsl/language/vscode';
import {
    PREVIEW_PATHS,
    PREVIEW_QUERY,
    type HostMessage,
    type ViewerMessage,
} from '@axis-dsl/protocol';
import { previewDebugEnabled, resolveDesmosApiKey } from './config';
import { imageHost, importHost } from './imports';

/**
 * How long a change waits before recompiling. Not a typing debounce - the
 * preview only reloads on save - but a save arrives twice, once as a document
 * event and once from the file watcher, and this collapses the pair.
 */
const DEBOUNCE_MS = 100;

/**
 * Proxies and reverse proxies buffer a response until it ends, which for an
 * event stream is never. This is the header they agree means "do not".
 */
const SSE_HEADERS = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
} as const;

/** Comment frames, often enough that an idle stream is never taken for dead. */
const HEARTBEAT_MS = 30_000;

/**
 * The viewer bundle inside this extension's `dist`, copied there at build time
 * by `scripts/copy-viewer-bundle.mjs`. Deliberately not named after any module
 * in `src/`: `tsc` emits into the same folder and would overwrite it.
 */
const VIEWER_BUNDLE = 'viewer.js';

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        character =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
    );
}

/** The file name of `uri`, without pulling in `path` for the one call. */
export function basename(uri: vscode.Uri): string {
    return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

/**
 * The page: a root element and the viewer bundle, and nothing else.
 *
 * The bundle reads the token and file out of the page's own URL, so the only
 * thing this has to get right is passing the query string on to it.
 */
function page(uri: vscode.Uri, query: string): string {
    return `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(basename(uri))} — Axis</title>
    <style>
        html, body, #root { height: 100%; margin: 0; overflow: hidden; }
        body { background: light-dark(#ffffff, #16181d); color-scheme: light dark; }
    </style>
</head>

<body>
    <div id="root"></div>
    <script src="${PREVIEW_PATHS.bundle}${query}"></script>
</body>

</html>`;
}

/** One previewed file: everything watching it, and everyone watching it. */
interface Preview {
    uri: vscode.Uri;
    clients: Set<http.ServerResponse>;
    subscriptions: vscode.Disposable[];
    /**
     * A watcher per file the script reads - imported or drawn - keyed by URI.
     * The set is rebuilt after every compile, since an edit is what changes
     * which files those are.
     */
    dependencies: Map<string, vscode.Disposable>;
    timer?: ReturnType<typeof setTimeout>;
}

/** A previewed file, as the status bar reports it. */
export interface PreviewSession {
    uri: vscode.Uri;
    /** Pages currently connected. Zero once every tab on it is closed. */
    viewers: number;
}

/**
 * Serves the Axis preview over loopback HTTP.
 *
 * One server for the window, started on the first preview and shared by every
 * page after it — a dev server, in the sense a web project would mean it. A
 * page is bound to a file by its URL rather than by anything the server
 * remembers, which is what lets several previews of several files be open at
 * once and makes each one's subject visible in its own address bar.
 *
 * It binds to 127.0.0.1 and every route requires a per-session token, because
 * anything else running on the machine can reach a loopback port and the server
 * will read out the contents of any file it is asked for.
 */
export class PreviewServer implements vscode.Disposable {
    private readonly token = randomUUID();
    private readonly previews = new Map<string, Preview>();
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    /** Fires whenever {@link isRunning} or {@link sessions} would read anew. */
    public readonly onDidChange = this.changeEmitter.event;

    private server: http.Server | undefined;
    private origin: string | undefined;
    /** The listen, kept so concurrent first previews share one server. */
    private starting: Promise<string> | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public get isRunning(): boolean {
        return this.server !== undefined;
    }

    /** Every file served since the server started, newest last. */
    public get sessions(): PreviewSession[] {
        return [...this.previews.values()].map(preview => ({
            uri: preview.uri,
            viewers: preview.clients.size,
        }));
    }

    /**
     * The URL a browser should open to preview `uri`, starting the server if it
     * is not up yet. Passed through `asExternalUri` so that under a remote —
     * SSH, WSL, a container — the caller gets the forwarded address rather than
     * a loopback one that means nothing on the machine the browser runs on.
     */
    public async previewUrl(uri: vscode.Uri): Promise<vscode.Uri> {
        const origin = await this.start();
        // Registered now rather than when a page connects, so the file shows up
        // as served even if the browser is slow to open or never does.
        this.watch(uri);
        this.changeEmitter.fire();

        // Parsed whole rather than assembled with `.with({ query })`, because a
        // `Uri` holds its components *decoded* and re-escapes them on the way
        // out. A query handed over already escaped is escaped a second time -
        // `openExternal` runs `encodeURI(uri.toString(true))`, which turns
        // `%3A` into `%253A` - and this server then 404s the file it names.
        // Parsing decodes the escapes once so that the re-encode lands on the
        // string that was meant.
        const url = vscode.Uri.parse(`${origin}${PREVIEW_PATHS.page}?${this.queryFor(uri)}`, true);
        return vscode.env.asExternalUri(url);
    }

    private queryFor(uri: vscode.Uri): string {
        const params = new URLSearchParams();
        params.set(PREVIEW_QUERY.token, this.token);
        params.set(PREVIEW_QUERY.file, uri.toString());
        // Read when the link is made rather than by the page, which is served
        // as a static bundle and has no way to ask VSCode anything. Changing
        // the setting therefore takes a reopened preview, not a reload.
        if (previewDebugEnabled()) {
            params.set(PREVIEW_QUERY.debug, '1');
        }
        return params.toString();
    }

    private start(): Promise<string> {
        this.starting ??= new Promise<string>((resolve, reject) => {
            const server = http.createServer((request, response) => {
                void this.handle(request, response);
            });
            server.on('error', reject);
            // Port 0 lets the OS pick a free one; a fixed port would collide
            // with a second window running the same extension.
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (typeof address === 'object' && address) {
                    this.server = server;
                    this.origin = `http://127.0.0.1:${address.port}`;
                    this.changeEmitter.fire();
                    resolve(this.origin);
                } else {
                    reject(new Error('The Axis preview server reported no address.'));
                }
            });
        });

        // A failed listen must not be cached, or every later preview in this
        // window would reject with the first attempt's error.
        this.starting.catch(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    /** The address the server is listening on, or undefined if it is not. */
    public get address(): string | undefined {
        return this.origin;
    }

    // ── Requests ────────────────────────────────────────────────────────────

    private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');

        // One check covers every route. Anything without the token is treated
        // as a request for something that is not there, rather than as a
        // forbidden request for something that is.
        if (url.searchParams.get(PREVIEW_QUERY.token) !== this.token) {
            response.writeHead(404).end();
            return;
        }

        try {
            switch (url.pathname) {
                case PREVIEW_PATHS.bundle:
                    return await this.serveBundle(response);
                case PREVIEW_PATHS.page:
                    return this.servePage(url, response);
                case PREVIEW_PATHS.events:
                    return this.serveEvents(url, request, response);
                case PREVIEW_PATHS.host:
                    return await this.serveHostMessage(request, response);
                default:
                    response.writeHead(404).end();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!response.headersSent) {
                response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            }
            response.end(message);
        }
    }

    /**
     * The file a request is about, or undefined if it is not one this server
     * will serve. The token stops anything else on the machine reaching this at
     * all; the extension check is the second lock, so that a leaked URL still
     * cannot be edited into a reader for arbitrary files.
     */
    private fileFrom(url: URL): vscode.Uri | undefined {
        const raw = url.searchParams.get(PREVIEW_QUERY.file);
        if (!raw) {
            return undefined;
        }
        try {
            const uri = vscode.Uri.parse(raw, true);
            return uri.path.endsWith(AXIS_FILE_EXTENSION) ? uri : undefined;
        } catch {
            return undefined;
        }
    }

    private async serveBundle(response: http.ServerResponse) {
        const bundle = vscode.Uri.joinPath(this.context.extensionUri, 'dist', VIEWER_BUNDLE);
        const contents = await readFile(bundle.fsPath);
        response.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        response.end(contents);
    }

    private servePage(url: URL, response: http.ServerResponse) {
        const uri = this.fileFrom(url);
        if (!uri) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        response.end(page(uri, `?${this.queryFor(uri)}`));
    }

    /**
     * Opens a page's event stream and hands it the current state.
     *
     * This, not the viewer's `ready`, is what starts the conversation: `ready`
     * is sent on mount, which can beat the stream being connected, and a reply
     * to it would go nowhere.
     */
    private serveEvents(url: URL, request: http.IncomingMessage, response: http.ServerResponse) {
        const uri = this.fileFrom(url);
        if (!uri) {
            response.writeHead(404).end();
            return;
        }

        response.writeHead(200, SSE_HEADERS);
        // Some clients hold the first bytes back until something arrives.
        response.write(': connected\n\n');

        const preview = this.watch(uri);
        preview.clients.add(response);
        this.changeEmitter.fire();

        const heartbeat = setInterval(() => response.write(': ping\n\n'), HEARTBEAT_MS);
        request.on('close', () => {
            clearInterval(heartbeat);
            preview.clients.delete(response);
            // The file stays served with no viewers on it, the way a dev server
            // keeps serving a route nobody has open. Stopping the server is
            // what ends it, so a reopened tab finds the same address alive.
            this.changeEmitter.fire();
        });

        this.send(response, {
            command: 'init',
            data: { desmosApiKey: resolveDesmosApiKey(), canSetApiKey: true },
        });
        this.send(response, { command: 'setStatus', data: { status: basename(uri) } });
        void this.compile(uri);
    }

    private async serveHostMessage(request: http.IncomingMessage, response: http.ServerResponse) {
        const body = await new Promise<string>((resolve, reject) => {
            let text = '';
            request.setEncoding('utf8');
            request.on('data', chunk => {
                text += chunk;
            });
            request.on('end', () => resolve(text));
            request.on('error', reject);
        });

        let message: HostMessage;
        try {
            message = JSON.parse(body) as HostMessage;
        } catch {
            response.writeHead(400).end();
            return;
        }

        // `ready` needs no answer: the event stream already sent the state.
        if (message.command === 'requestApiKey') {
            // Only the host knows where a key lives; the viewer just asks.
            void vscode.commands.executeCommand('workbench.action.openSettings', 'axis.apiKey');
        }
        response.writeHead(204).end();
    }

    // ── Watching ────────────────────────────────────────────────────────────

    private watch(uri: vscode.Uri): Preview {
        const key = uri.toString();
        const existing = this.previews.get(key);
        if (existing) {
            return existing;
        }

        const preview: Preview = {
            uri,
            clients: new Set(),
            subscriptions: [],
            dependencies: new Map(),
        };
        preview.subscriptions.push(this.watchFile(uri, preview));

        this.previews.set(key, preview);
        return preview;
    }

    /**
     * Recompile `preview` whenever the file at `uri` changes.
     *
     * The preview reloads on save, not on every keystroke — the same bargain a
     * web dev server strikes, and the reason it is safe to let a half-typed
     * line sit in the editor without the graph reacting to it. The watcher
     * covers saves made outside VSCode; the document event covers the ones made
     * in it, because a file watcher can lag behind the editor's own write by
     * enough to feel broken.
     */
    private watchFile(uri: vscode.Uri, preview: Preview): vscode.Disposable {
        const key = uri.toString();
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), basename(uri)),
        );

        const subscriptions = [
            watcher,
            watcher.onDidChange(() => this.scheduleCompile(preview)),
            // A file that was missing and is now there is a change too: it is
            // how an import that failed to resolve starts resolving.
            watcher.onDidCreate(() => this.scheduleCompile(preview)),
            vscode.workspace.onDidSaveTextDocument(document => {
                if (document.uri.toString() === key) {
                    this.scheduleCompile(preview);
                }
            }),
        ];

        return new vscode.Disposable(() =>
            subscriptions.forEach(subscription => subscription.dispose()),
        );
    }

    /**
     * Watch exactly the files `preview` currently reads: what it imports, and
     * the pictures it draws.
     *
     * Both are part of what a script is, so saving one has to reload the graph
     * just as saving the script does — and a file that is no longer named stops
     * being watched, rather than waking the preview for the rest of the session.
     */
    private watchDependencies(preview: Preview, dependencies: string[]): void {
        const wanted = new Set(dependencies);

        for (const [key, subscription] of preview.dependencies) {
            if (!wanted.has(key)) {
                subscription.dispose();
                preview.dependencies.delete(key);
            }
        }

        for (const key of wanted) {
            // The script itself is already watched; a file that imports it back
            // does not need watching twice.
            if (preview.dependencies.has(key) || key === preview.uri.toString()) {
                continue;
            }
            preview.dependencies.set(key, this.watchFile(vscode.Uri.parse(key), preview));
        }
    }

    private scheduleCompile(preview: Preview) {
        clearTimeout(preview.timer);
        preview.timer = setTimeout(() => void this.compile(preview.uri), DEBOUNCE_MS);
    }

    private async compile(uri: vscode.Uri) {
        const preview = this.previews.get(uri.toString());
        if (!preview || preview.clients.size === 0) {
            return;
        }

        try {
            // Read from disk, not from the open document. What the preview
            // shows is what is saved, so an unsaved buffer never leaks into it
            // by way of some other file's save waking this up.
            const bytes = await vscode.workspace.fs.readFile(uri);
            const source = new TextDecoder().decode(bytes);

            // Imports and images are read up front so that compilation itself
            // stays synchronous, which is what lets the compiler run unchanged
            // in a browser that has no filesystem to read.
            const path = uri.toString();
            const files = await loadImports({ path, source }, importHost);
            const pictures = await loadImages({ path, source }, files, imageHost);
            const { expressions, settings, graph, state, ticker, imports, images } = compileAxis(
                source,
                {
                    path,
                    resolveImport: createImportResolver(files, importHost.resolve),
                    resolveImage: createImageResolver(pictures, imageHost.resolve),
                },
            );

            this.watchDependencies(preview, [...imports, ...images]);
            this.broadcast(preview, {
                command: 'setExpressions',
                data: { expressions, settings, graph, state, ticker },
            });
            this.broadcast(preview, {
                command: 'setStatus',
                data: { status: basename(uri) },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Said in both places: the page is where the user is looking, and
            // the window is where they can act on it.
            this.broadcast(preview, { command: 'setStatus', data: { status: message } });
            void vscode.window.showErrorMessage(`Error compiling axis file: ${message}`);
        }
    }

    /** Typed by the protocol, so the two ends cannot drift. */
    private send(response: http.ServerResponse, message: ViewerMessage) {
        response.write(`data: ${JSON.stringify(message)}\n\n`);
    }

    private broadcast(preview: Preview, message: ViewerMessage) {
        preview.clients.forEach(client => this.send(client, message));
    }

    /**
     * Close every connection and stop listening. The next preview starts a
     * fresh server — on a new port, with a new token, so pages left open on the
     * old one stay dead rather than silently reattaching to a different graph.
     */
    public stop() {
        this.previews.forEach(preview => {
            clearTimeout(preview.timer);
            preview.subscriptions.forEach(subscription => subscription.dispose());
            preview.dependencies.forEach(subscription => subscription.dispose());
            preview.clients.forEach(client => client.end());
        });
        this.previews.clear();
        this.server?.close();
        this.server = undefined;
        this.origin = undefined;
        this.starting = undefined;
        this.changeEmitter.fire();
    }

    public dispose() {
        this.stop();
        this.changeEmitter.dispose();
    }
}
