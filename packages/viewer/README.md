# @axis-dsl/viewer

The [Axis](https://github.com/jayson-clark/axis) results panel: a live Desmos
graph, and — in `debug` — the JSON behind it beside it.

```sh
npm install @axis-dsl/viewer react react-dom
```

`react` is a peer dependency. Desmos itself is loaded at runtime from
`desmos.com` using the API key you supply — nothing to install.

## Usage

```tsx
import { compileAxis } from '@axis-dsl/compiler';
import { AxisViewer, useLocalViewerHost } from '@axis-dsl/viewer';

function Preview({ source }: { source: string }) {
    const { expressions, settings } = compileAxis(source);
    const transport = useLocalViewerHost({
        apiKey: MY_DESMOS_KEY,
        expressions,
        settings,
        status: `${expressions.length} expressions`
    });

    return <AxisViewer transport={transport} />;
}
```

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

`AxisViewer` has no props for expressions, settings, the API key or status —
everything it displays arrives as a message over a `ViewerTransport` from
`@axis-dsl/protocol`. `useLocalViewerHost` is the in-process transport for a
host that renders the viewer itself; `createHttpTransport()` is the one the
VSCode extension's preview page uses to reach its server. Same viewer either
way.

Pass `onRequestApiKey` to `useLocalViewerHost` and the viewer offers a "Set an
API key" button that calls it. Leave it out and the button is not rendered at
all, rather than leading nowhere.

A transport with a wire can also report whether it still has one, via
`onConnectionChange`. When it drops, the viewer says so above the graph instead
of leaving a stale one looking current — a first connection is silent, a
reconnection reads as "Reconnecting…", and a connection given up on reads as
stopped. A transport that omits `onConnectionChange`, as the in-process channel
does, is taken to be connected for as long as it exists.

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

| Export                      |                                                                         |
| --------------------------- | ----------------------------------------------------------------------- |
| `AxisViewer`                | The panel. Props: `transport`, `debug?`, `ref?`, `className?`, `style?` |
| `useLocalViewerHost(state)` | Turns React state into protocol messages; returns the transport         |
| `AxisViewerHandle`          | What its `ref` exposes: `capture(options?)`, `getGraph()`               |
| `DesmosGraph`               | Just the graph, if you want to arrange things yourself                  |
| `JsonInspector`             | Just the JSON pane                                                      |
| `useDesmos(apiKey)`         | Loads the Desmos script once per page                                   |
| `useViewerState(transport)` | The state `AxisViewer` builds from the messages                         |
| `AXIS_THEME`                | The palette, as `--axis-*` custom properties                            |
| `AXIS_COLOR_SCHEME`         | The `color-scheme` those properties need to resolve                     |

MIT
