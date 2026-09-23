// ═════════════════════════════════════════════════════════════════════════════
// The language client - every editor feature, from the Axis language server
// ═════════════════════════════════════════════════════════════════════════════
//
// Diagnostics, completion, hover, formatting, semantic tokens, links and
// navigation all come from `@axis-dsl/language-server`, the same server
// Neovim, Helix and Zed run. It is bundled beside this file as `server.js` and
// started as a node child process over IPC; the client registers the rest.

import * as vscode from 'vscode';
import {
    LanguageClient,
    TransportKind,
    type LanguageClientOptions,
    type ServerOptions,
} from 'vscode-languageclient/node';
import type { AxisInitializationOptions } from '@axis-dsl/language-server';
import { AXIS_LANGUAGE_ID } from '@axis-dsl/language-service';

/** The bundled server, beside `extension.js` in `dist`. */
const SERVER_BUNDLE = 'dist/server.js';

export function createLanguageClient(context: vscode.ExtensionContext): LanguageClient {
    const module = context.asAbsolutePath(SERVER_BUNDLE);
    const serverOptions: ServerOptions = {
        run: { module, transport: TransportKind.ipc },
        // Under the debugger, the server can be attached to on 6009.
        debug: {
            module,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] },
        },
    };

    const initializationOptions: AxisInitializationOptions = {
        // Completing a path a segment at a time: accepting a directory opens
        // the list again, on what is inside it.
        retriggerCommand: 'editor.action.triggerSuggest',
    };

    const clientOptions: LanguageClientOptions = {
        // Every scheme, untitled buffers included: the server checks what it
        // is sent, and only a path it has to read off disk needs a file.
        documentSelector: [{ language: AXIS_LANGUAGE_ID }],
        initializationOptions,
    };

    return new LanguageClient('axis', 'Axis Language Server', serverOptions, clientOptions);
}
