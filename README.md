<img src="assets/axis-banner.svg" alt="Axis" width="220">

**A scripting language for [Desmos](https://www.desmos.com).** Write a `.axis`
file and it compiles to the expressions, folders, tables and settings a graph is
made of — with a VSCode extension that graphs it as you type.

```
config {
    showGrid: true,
    degreeMode: false
}

"Basic functions"

f(x) = x^2 - 4x + 3     # color: #c74440
g(x) = sin(x) + cos(2x) # color: #2d70b3, lineWidth: 2

table { x = [1, 2, 3], y = [1, 4, 9] }
```

## Features

- **Plain text graphs** — version them, diff them, review them
- **Live preview** — the graph updates as you edit
- **Editor support** — syntax highlighting, completions, formatting, diagnostics
- **Embeddable** — the compiler, editor and viewer ship as npm packages

## Quick start

Requires [Node](https://nodejs.org) 22+ and [pnpm](https://pnpm.io) 11+
(`corepack enable` picks up the `packageManager` field).

```sh
git clone https://github.com/jayson-clark/axis
cd axis
pnpm install
pnpm dev
```

Press <kbd>F5</kbd> in VSCode (the "Extension" launch config) to open an
Extension Development Host, then open a file from
[`examples/scripts/`](./examples/scripts) and hit the graph button in the editor
title bar (or run **Axis: Preview Graph**). It asks whether to open in a Simple
Browser tab or your real browser — pin an answer to stop being asked, or set
`axis.previewTarget` back to `ask` to be asked again.

The preview is a page served over loopback, not a panel inside the editor, so it
never competes for a spot in the workbench and you can have as many open as you
have files. Each one is bound to the file you launched it from and reloads when
you save it, the same bargain a web dev server strikes.

While the server is up there is an `$(broadcast) Axis` item in the status bar.
Click it to reopen a preview whose tab you closed, serve another file, or stop
the server.

Those examples are a tour of the language, one topic per file - functions,
piecewise, styling, folders, sliders, lists, tables, parametric and polar
curves, inequalities, click actions and config - plus four complete graphs to
read as finished work.

Desmos' public demo key is built in, so the graph works with no setup. To ship
your own, [get a key](https://www.desmos.com/api) and set `axis.apiKey` in
VSCode settings.

## Use it in your own app

```sh
npm install @axis-dsl/compiler @axis-dsl/editor @axis-dsl/viewer monaco-editor react react-dom
```

Compile anywhere — a build step, a server, a test:

```ts
import { compileAxis } from '@axis-dsl/compiler';

const { expressions, settings } = compileAxis(source);
```

Or drop the editor and graph into a React app:

```tsx
import { compileAxis } from '@axis-dsl/compiler';
import { AxisEditor } from '@axis-dsl/editor';
import { AxisViewer, useLocalViewerHost } from '@axis-dsl/viewer';
import * as monaco from 'monaco-editor';

function Playground() {
    const [source, setSource] = useState('y = x^2 # color: #c74440');
    const { expressions, settings } = compileAxis(source);
    const transport = useLocalViewerHost({ apiKey: MY_DESMOS_KEY, expressions, settings });

    return (
        <>
            <AxisEditor monaco={monaco} value={source} onChange={setSource} theme="dark" />
            <AxisViewer transport={transport} />
        </>
    );
}
```

React 19 and Monaco 0.56+ are peer dependencies, so your app owns both.
`examples/web` is a runnable Vite app wiring all of this up.

## Packages

| Package              | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `@axis-dsl/compiler` | Compiles `.axis` source to Desmos expressions   |
| `@axis-dsl/language` | Completions, formatting, diagnostics, grammars  |
| `@axis-dsl/editor`   | Monaco bound to the Axis language, themed       |
| `@axis-dsl/viewer`   | The results panel: the graph and JSON inspector |
| `@axis-dsl/protocol` | Messages and transports that drive the viewer   |
| `@axis-dsl/desmos`   | Typed Desmos calculator API                     |

## Scripts

| Command          | Description                                 |
| ---------------- | ------------------------------------------- |
| `pnpm build`     | Build every package in dependency order     |
| `pnpm dev`       | Build once, then watch every package        |
| `pnpm test`      | Build, then run the suites on `node --test` |
| `pnpm typecheck` | Typecheck everything, tests included        |
| `pnpm format`    | Rewrite with Prettier                       |
| `pnpm clean`     | Remove every `dist/` and `*.tsbuildinfo`    |

## License

[MIT](./LICENSE)
