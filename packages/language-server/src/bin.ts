#!/usr/bin/env node
// `axis-language-server --stdio`: the server, for any editor that can start a
// process and talk to it. The transport flag is read by `createConnection`.

import { startServer } from './index';

startServer();
