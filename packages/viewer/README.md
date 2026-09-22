# @axis-dsl/viewer

The [Axis](https://github.com/jayson-clark/axis) results panel: a live Desmos
graph, and — in `debug` — the JSON behind it beside it. Also the protocol every
host drives it with, and the transports that carry that protocol, at
`@axis-dsl/viewer/protocol`.

```sh
npm install @axis-dsl/viewer react react-dom
```

`react` is a peer dependency. Desmos itself is loaded at runtime from
`desmos.com` using the API key you supply — nothing to install.

## Usage

```tsx
import { useMemo } from 'react';
import { compileAxis, toGraph } from '@axis-dsl/compiler';
import { AxisViewer, useLocalViewerHost } from '@axis-dsl/viewer';

function Preview({ source }: { source: string }) {
    const { state, options } = useMemo(() => toGraph(compileAxis(source)), [source]);
    const transport = useLocalViewerHost({
        apiKey: MY_DESMOS_KEY,
        state,
        options,
        status: `${state.expressions?.list?.length ?? 0} expressions`,
    });

    return <AxisViewer transport={transport} />;
}
```

A graph is two things, `state` and `options`, because Desmos has two ways in:
the viewer applies them as `calculator.setState(state)` and then
`calculator.updateSettings(options)`, and does nothing else to them. Everything
the graph is made of — the expression list, the ticker, the viewport, the
top-level flags — is in `state`, so a graph looks the same in every host that
shows it.

## Debug mode

The viewer is the graph and nothing else by default: no tabs, no status line,
the calculator filling whatever it is given. `debug` adds the **Graph**/**JSON**
tabs and the status the transport reports, for a host that is a workbench rather
than a preview.

```tsx
<AxisViewer transport={transport} debug />
```

The graph is the same either way — the JSON pane is what `debug` adds, so the
`status` a host reports has somewhere to appear only when it is on.

## One way in

`AxisViewer` has no props for the graph, the API key or the status. Everything
it displays arrives as a `ViewerMessage` over a `ViewerTransport`, and
everything it asks for goes back as a `HostMessage`. One path in means a feature
is built once and every host gets it — the VSCode preview over an HTTP event
stream, a web playground over an in-memory channel. Same viewer either way.

```ts
type ViewerMessage =
    | { command: 'init'; data: { desmosApiKey: string; canSetApiKey?: boolean } }
    | { command: 'setGraph'; data: { state: GraphState; options: CalculatorOptions } }
    | { command: 'setStatus'; data: { status: string | null } }
    | { command: 'setSync'; data: { enabled: boolean } };

type HostMessage =
    | { command: 'ready' }
    | { command: 'requestApiKey' }
    | { command: 'graphChanged'; data: { before: GraphReading; after: GraphReading } };
```

The viewer sends `ready` on mount; the host answers with `init` and the current
graph. `setGraph` replaces the graph whole, and one that is the same as the last
is not applied again, so re-sending an unchanged graph leaves the viewport
wherever the user panned it. `requestApiKey` is only ever sent to a host that
set `canSetApiKey`, because only a host with somewhere to put a key can act on
it — the extension opens VSCode settings, a host with one baked in has nowhere.
Pass `onRequestApiKey` to `useLocalViewerHost` and the viewer offers a "Set an
API key" button that calls it; leave it out and the button is not rendered at
all, rather than leading nowhere.

The messages and transports live at `@axis-dsl/viewer/protocol`, a subpath that
imports neither React nor the DOM when loaded, so the other end of the wire can
be a Node process: the extension's preview server imports it in the VSCode
extension host. The package root re-exports the protocol's types for a React
host that wants to name them.

### In-process

`useLocalViewerHost` is the transport for a host that renders the viewer itself,
and is what a React host should reach for first. Underneath it is
`createLocalChannel`, two ends of a synchronous channel with no wire between
them:

```ts
import { createLocalChannel } from '@axis-dsl/viewer/protocol';

const { host, viewer } = createLocalChannel();

host.onMessage(message => {
    if (message.command === 'ready') {
        host.send({ command: 'init', data: { desmosApiKey: key } });
        host.send({ command: 'setGraph', data: { state, options } });
    }
});

<AxisViewer transport={viewer} />;
```

### Across a wire

`createHttpTransport` is the viewer's end of a connection to the extension's
preview server: Server-Sent Events downstream, a POST per message upstream. It
defaults every option out of the page's own URL, so the page that loads the
viewer usually needs no arguments:

```ts
import { createHttpTransport } from '@axis-dsl/viewer/protocol';

<AxisViewer transport={createHttpTransport()} />;
```

SSE rather than a WebSocket because the traffic is almost entirely one-way — the
viewer sends two messages in its life — and it needs no dependency on either
end. It also reconnects on its own.

A transport with a wire can report whether it still has one, through the
optional `onConnectionChange`. A momentary drop reads as `connecting` and
recovers silently; only a stream that spends `reconnectGraceMs` (3s by default)
failing to come back is called `disconnected`, at which point the viewer says so
above the graph rather than leaving a stale one looking current. A first
connection is silent. A transport that omits `onConnectionChange`, as the
in-process channel does, is taken to be connected for as long as it exists.

`PREVIEW_PATHS` and `PREVIEW_QUERY` are the preview server's HTTP surface — the
routes and the query keys — kept here because both ends depend on this package
and neither can see the other at runtime. `PREVIEW_QUERY.token` is a per-session
secret every route requires: any process on the machine can reach a loopback
port.

## Editing from the graph

Pass `onGraphChanged` to `useLocalViewerHost` and the viewer watches the
calculator for what the user does to the graph directly — dragging a point,
moving a slider, recolouring something, panning — and hands back two readings:
the graph as it was when your graph was applied, and the graph now. Over the
protocol this is `setSync` turning on `graphChanged`.

```ts
const transport = useLocalViewerHost({
    apiKey,
    state,
    options,
    onGraphChanged: (before, after) => {
        const { edits } = writeBackGraph(compiled, before, after, files);
        // …apply them to the script the graph was compiled from
    },
});
```

Leave it out and the calculator is not watched at all — the viewer only starts
looking when a host says it has somewhere to put the answer.

The difference between the two readings is the user's doing and nothing else.
The baseline is read back off the calculator rather than taken from the state
that produced it, because Desmos normalises what it is given: a state compared
against what was sent would report a change on every expression the moment the
graph loaded. Reports are debounced, since a drag is hundreds of `change` events
and one edit.

A reading is a `GraphReading` — `{ expressions, settings?, graph?, state?,
ticker? }`, the calculator's state taken apart — because that is what
`writeBackGraph` in `@axis-dsl/compiler` compares, and it is what turns the pair
into edits to the statements that produced them.

## Capturing an image

A `ref` on `AxisViewer` hands back the graph it owns, whose `capture()` renders
the graphpaper to a data URI — the expression list is never in it. It resolves
`null` until Desmos has loaded and the calculator exists, so the affordance can
be offered before knowing whether it has.

```tsx
const viewer = useRef<AxisViewerHandle>(null);

async function download() {
    const png = await viewer.current?.capture({ width: 1200, height: 800, targetPixelRatio: 2 });
    if (png) {
        // …it's yours: save it, put it on the clipboard, upload it as a thumbnail
    }
}

return <AxisViewer ref={viewer} transport={transport} />;
```

The options are Desmos' own `asyncScreenshot` options (`width`, `height`,
`targetPixelRatio`, `format`, `mode`, `mathBounds`, `showLabels`,
`preserveAxisNumbers`), typed as `AsyncScreenshotOptions` in `@axis-dsl/desmos`.
Passing none captures the graph as it is on screen. `getGraph()` on the same
handle reaches the rest of `DesmosGraphHandle` — `getCalculator()`,
`getExpressions()`, `getState()`.

## Theming

The viewer brings its own palette and looks the same in every host — nothing
needs configuring, and it follows the OS light/dark setting on its own. The
palette is published as `AXIS_THEME`, a set of `--axis-*` custom properties
applied to the panel's root element:

```css
--axis-fg  --axis-fg-muted  --axis-surface  --axis-surface-raised
--axis-border  --axis-accent  --axis-accent-fg  --axis-danger
--axis-font  --axis-font-size  --axis-mono  --axis-mono-size
```

A host that needs different colours passes any of them in `style`, which is
applied after the theme and therefore wins:

```tsx
<AxisViewer transport={transport} style={{ '--axis-accent': '#c2410c' }} />
```

## API

| Export                      |                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `AxisViewer`                | The panel. Props: `transport`, `debug?`, `ref?`, `className?`, `style?`             |
| `useLocalViewerHost(host)`  | Turns `{ apiKey, state, options, … }` into protocol messages; returns the transport |
| `AxisViewerHandle`          | What its `ref` exposes: `capture(options?)`, `getGraph()`                           |
| `DesmosGraph`               | Just the graph, if you want to arrange things yourself                              |
| `JsonInspector`             | Just the JSON pane                                                                  |
| `useDesmos(apiKey)`         | Loads the Desmos script once per page                                               |
| `useViewerState(transport)` | The state `AxisViewer` builds from the messages                                     |
| `AXIS_THEME`                | The palette, as `--axis-*` custom properties                                        |
| `AXIS_COLOR_SCHEME`         | The `color-scheme` those properties need to resolve                                 |

From `@axis-dsl/viewer/protocol`:

| Export                                          |                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `ViewerMessage` / `HostMessage` / `AxisMessage` | The protocol                                                                     |
| `ViewerGraph`                                   | `{ state: GraphState, options: CalculatorOptions }`, what `setGraph` carries     |
| `GraphReading`                                  | A graph read back off the calculator in parts, as `graphChanged` carries it      |
| `ViewerTransport` / `HostTransport`             | The two ends of a connection                                                     |
| `createLocalChannel()`                          | An in-process channel; returns `{ host, viewer }`                                |
| `createHttpTransport(options?)`                 | The SSE + POST transport, for a viewer served over HTTP                          |
| `HttpTransportOptions`                          | `{ token?, file?, origin?, reconnectGraceMs? }`, all defaulted from the page URL |
| `ConnectionState`                               | `'connecting' \| 'connected' \| 'disconnected'`                                  |
| `PREVIEW_PATHS` / `PREVIEW_QUERY`               | The preview server's routes and query keys                                       |

MIT
