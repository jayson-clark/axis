// The entry point bundled as `dist/server.js`: the Axis language server, run
// by the client in `client.ts` as a child process. It reads `--node-ipc` from
// its arguments, which is how the client says to talk over IPC.

import { startServer } from '@axis-dsl/language-server';

startServer();
