// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/language-server - Axis over the Language Server Protocol
// ═════════════════════════════════════════════════════════════════════════════
//
// `@axis-dsl/language-service` answers every question an editor asks; this is
// the file-system half it leaves to a host, and the protocol around both. The
// `axis-language-server` bin runs it over stdio for Neovim, Helix, Zed and
// anything else that speaks LSP; the VSCode extension bundles it and runs it
// over node IPC.

import { createConnection, ProposedFeatures, type Connection } from 'vscode-languageserver/node';
import { listen } from './server';

export { diagnose, listen, type AxisInitializationOptions } from './server';

/**
 * Start the server. Without a connection, one is made from the process's
 * arguments - `--stdio`, `--node-ipc` or `--socket=<port>`, which is how an
 * editor says which it wants.
 */
export function startServer(connection: Connection = createConnection(ProposedFeatures.all)): void {
    listen(connection);
}
