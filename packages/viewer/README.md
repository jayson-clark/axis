# @axis-dsl/viewer

The [Axis](https://github.com/jayson-clark/axis) results panel: a live Desmos
graph beside the JSON behind it.

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

| Export                      |                                                                 |
| --------------------------- | --------------------------------------------------------------- |
| `AxisViewer`                | The panel. Props: `transport`, `className?`, `style?`           |
| `useLocalViewerHost(state)` | Turns React state into protocol messages; returns the transport |
| `DesmosGraph`               | Just the graph, if you want to arrange things yourself          |
| `JsonInspector`             | Just the JSON pane                                              |
| `useDesmos(apiKey)`         | Loads the Desmos script once per page                           |
| `useViewerState(transport)` | The state `AxisViewer` builds from the messages                 |
| `AXIS_THEME`                | The palette, as `--axis-*` custom properties                    |
| `AXIS_COLOR_SCHEME`         | The `color-scheme` those properties need to resolve             |

MIT
