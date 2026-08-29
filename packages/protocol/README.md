# @axis-dsl/protocol

The messages every host uses to drive the
[Axis](https://github.com/jayson-clark/axis) viewer, and the transports that
carry them.

```sh
npm install @axis-dsl/protocol
```

## One way in

[`@axis-dsl/viewer`](https://www.npmjs.com/package/@axis-dsl/viewer) is a
display surface with no props for expressions, settings, the API key or status.
Everything it shows arrives as a `ViewerMessage`, and everything it asks for goes
back as a `HostMessage`. One path in means a feature is built once and every
host gets it — the VSCode preview over an HTTP event stream, a web playground
over an in-memory channel.

```ts
type ViewerMessage =
  | { command: 'init'; data: { desmosApiKey: string; canSetApiKey?: boolean } }
  | { command: 'setExpressions'; data: { expressions: DesmosExpression[]; settings?: CalculatorOptions } }
  | { command: 'setStatus'; data: { status: string | null } };

type HostMessage = { command: 'ready' } | { command: 'requestApiKey' };
```

The viewer sends `ready` on mount; the host answers with `init` and the current
expressions. `requestApiKey` is only ever sent to a host that set
`canSetApiKey`, because only a host that has somewhere to put a key can act on
it — the extension opens VSCode settings, a host with one baked in has nowhere.

## In-process

For a host that renders the viewer itself, `createLocalChannel` is two ends of a
synchronous channel with no wire between them:

```ts
import { createLocalChannel } from '@axis-dsl/protocol';

const { host, viewer } = createLocalChannel();

host.onMessage(message => {
  if (message.command === 'ready') {
    host.send({ command: 'init', data: { desmosApiKey: key } });
    host.send({ command: 'setExpressions', data: { expressions, settings } });
  }
});

<AxisViewer transport={viewer} />;
```

`useLocalViewerHost` in `@axis-dsl/viewer` is this wrapped up for React, and is
what a React host should reach for first.

## Across a wire

`createHttpTransport` is the viewer's end of a connection to the extension's
preview server: Server-Sent Events downstream, a POST per message upstream. It
defaults every option out of the page's own URL, so the page that loads the
viewer usually needs no arguments:

```ts
import { createHttpTransport } from '@axis-dsl/protocol';

<AxisViewer transport={createHttpTransport()} />;
```

SSE rather than a WebSocket because the traffic is almost entirely one-way — the
viewer sends two messages in its life — and it needs no dependency on either
end. It also reconnects on its own.

A transport with a wire can report whether it still has one, through the
optional `onConnectionChange`. A momentary drop reads as `connecting` and
recovers silently; only a stream that spends `reconnectGraceMs` (3s by default)
failing to come back is called `disconnected`, at which point the viewer says so
rather than leaving a stale graph looking current. A transport that omits
`onConnectionChange`, as the in-process channel does, is taken to be connected
for as long as it exists.

`PREVIEW_PATHS` and `PREVIEW_QUERY` are the server's HTTP surface — the routes
and the query keys — kept here because both ends depend on this package and
neither can see the other at runtime. `PREVIEW_QUERY.token` is a per-session
secret every route requires: any process on the machine can reach a loopback
port.

## API

| Export                                          |                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `ViewerMessage` / `HostMessage` / `AxisMessage` | The protocol                                                                     |
| `ViewerTransport` / `HostTransport`             | The two ends of a connection                                                     |
| `createLocalChannel()`                          | An in-process channel; returns `{ host, viewer }`                                |
| `createHttpTransport(options?)`                 | The SSE + POST transport, for a viewer served over HTTP                          |
| `HttpTransportOptions`                          | `{ token?, file?, origin?, reconnectGraceMs? }`, all defaulted from the page URL |
| `ConnectionState`                               | `'connecting' \| 'connected' \| 'disconnected'`                                  |
| `PREVIEW_PATHS` / `PREVIEW_QUERY`               | The preview server's routes and query keys                                       |

MIT
