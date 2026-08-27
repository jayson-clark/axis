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
host that renders the viewer itself; `createVsCodeTransport()` is the one that
crosses a VSCode webview boundary. Same viewer either way.

Pass `onRequestApiKey` to `useLocalViewerHost` and the viewer offers a "Set an
API key" button that calls it. Leave it out and the button is not rendered at
all, rather than leading nowhere.

## Theming

Colours come from `--axis-*` custom properties, so the surrounding page styles
the panel:

```css
--axis-fg  --axis-fg-muted  --axis-surface  --axis-surface-raised
--axis-border  --axis-accent  --axis-accent-fg  --axis-danger
--axis-mono  --axis-mono-size
```

Inside a VSCode webview the viewer detects it and maps these onto the
`--vscode-*` theme automatically.

## API

| Export                      |                                                                 |
| --------------------------- | --------------------------------------------------------------- |
| `AxisViewer`                | The panel. Props: `transport`, `className?`, `style?`           |
| `useLocalViewerHost(state)` | Turns React state into protocol messages; returns the transport |
| `DesmosGraph`               | Just the graph, if you want to arrange things yourself          |
| `JsonInspector`             | Just the JSON pane                                              |
| `useDesmos(apiKey)`         | Loads the Desmos script once per page                           |
| `useViewerState(transport)` | The state `AxisViewer` builds from the messages                 |
| `VSCODE_THEME_VARS`         | The `--axis-*` → `--vscode-*` mapping                           |

MIT
