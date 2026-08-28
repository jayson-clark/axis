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
- **Imports** — `import "./waves.axis"` drops a whole script in, as a folder
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
curves, inequalities, click actions, config and imports - plus four complete
graphs to read as finished work.

Desmos' public demo key is built in, so the graph works with no setup. To ship
your own, [get a key](https://www.desmos.com/api) and set `axis.apiKey` in
VSCode settings.

## Imports

`import` drops the whole of another script into this one, in a folder of its
own — the way to keep a long graph in several files, and to reuse one across
graphs.

```
import "./lib/waves.axis"                     // a folder called "waves"
import "./lib/waves.axis" as "Waves"          // …or called whatever you like
import "./lib/waves.axis" # collapsed: true   // styled like any other folder
```

The path is relative to the file the import is written in — a leading `/` is
relative to the workspace instead — and the `.axis` may be left off.

An imported file is **flattened**: whatever folders it organises itself with are
dropped, and everything they held joins the one folder the import makes. That
holds all the way down, so a file that imports a file that imports a file still
arrives as one flat folder. Desmos has one level of folders, and the import has
claimed it — which is also why an import written inside a folder joins that
folder rather than opening another.

The rest travels with it: an imported file's `config` block applies too, with
the importing script's settings winning wherever the two disagree. A file that
imports itself, however indirectly, is an error rather than a hang.

A preview watches everything the script imports, so saving any file the graph is
built from reloads it.

## Use it in your own app

```sh
npm install @axis-dsl/compiler @axis-dsl/language @axis-dsl/viewer monaco-editor react react-dom
```

Compile anywhere — a build step, a server, a test:

```ts
import { compileAxis } from '@axis-dsl/compiler';

const { expressions, settings } = compileAxis(source);
```

Compilation is synchronous and touches no filesystem, so a script with imports
is handed a resolver. `loadImports` walks the graph first over whatever reading
a file means where you are — `node:fs`, a VSCode workspace, a `Map`:

```ts
import { compileAxis, createImportResolver, loadImports } from '@axis-dsl/compiler';
import { withAxisExtension } from '@axis-dsl/language';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const host = {
    resolve: (specifier, from) => resolve(dirname(from), withAxisExtension(specifier)),
    read: (path) => readFile(path, 'utf8'),
};

const files = await loadImports({ path, source }, host);
const { expressions, settings, imports } = compileAxis(source, {
    path,
    resolveImport: createImportResolver(files, host.resolve),
});
```

`imports` comes back naming every file that was read, which is what to watch if
the graph is live.

To edit Axis, hand your own Monaco instance to `registerAxisLanguage`. It adds
highlighting, completions, formatting and diagnostics, plus the `axis-dark` and
`axis-light` themes, and is idempotent per instance:

```ts
import { registerAxisLanguage, AXIS_LANGUAGE_ID, AXIS_DARK_THEME } from '@axis-dsl/language/monaco';
import * as monaco from 'monaco-editor';

registerAxisLanguage(monaco);

monaco.editor.create(container, {
    value: 'y = x^2 # color: #c74440',
    language: AXIS_LANGUAGE_ID,
    theme: AXIS_DARK_THEME,
});
```

Axis deliberately ships no editor component: loading Monaco and wrapping it for
your framework is app-shaped work that every bundler spells differently.
`examples/web/src/AxisEditor.tsx` is a ~150-line React wrapper to copy, and
`examples/web/src/monaco.ts` shows the Vite loading and worker setup.

The graph half is a component, since it owns a Desmos instance:

```tsx
import { compileAxis } from '@axis-dsl/compiler';
import { AxisViewer, useLocalViewerHost } from '@axis-dsl/viewer';

function Graph({ source }) {
    const { expressions, settings } = compileAxis(source);
    const transport = useLocalViewerHost({ apiKey: MY_DESMOS_KEY, expressions, settings });

    return <AxisViewer transport={transport} />;
}
```

React 19 and Monaco 0.56+ are peer dependencies, so your app owns both.
`examples/web` is a runnable Vite app wiring all of this up.

## Packages

| Package              | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `@axis-dsl/compiler` | Compiles `.axis` source to Desmos expressions   |
| `@axis-dsl/language` | Completions, formatting, diagnostics, grammars  |
| `@axis-dsl/viewer`   | The results panel: the graph and JSON inspector |
| `@axis-dsl/protocol` | Messages and transports that drive the viewer   |
| `@axis-dsl/desmos`   | Typed Desmos calculator API                     |
| `@axis-dsl/harness`  | Runs a script against a real headless Desmos    |

## Testing against a real Desmos graph

The compiler can only tell you what it emitted.
[`@axis-dsl/harness`](./packages/harness) tells you what Desmos made of it: it
loads a script into a real calculator in a headless Chromium and hands back the
graph state, the expression list, and Desmos' own verdict on every expression.

```sh
pnpm test:browser   # download Chromium, once
```

```sh
$ npx axis-inspect examples/scripts/16-imports.axis
16-imports.axis — 15 expressions, 0 errors

  0  text       Two libraries, each arriving as one folder.
  1  folder     Waves
  2  ok         a_{mp}=1 = 1
  …
```

`--json` makes that machine-readable and the command exits `1` on a graph with
errors, which is what makes it useful to an agent or a CI check. In a test:

```ts
await calculator.load('f(x) = 2x + 1\ny = f(x)');
assert.deepEqual(await calculator.getErrors(), []);
assert.equal((await calculator.evaluate('f(20)')).numericValue, 41);
```

Its suites drive every metadata property, every config option, and every
function and constant in the language manifest through a live calculator, so a
name that Desmos does not accept fails a test rather than a graph.

The real `calculator.js` is cached on disk after the first run, so the suite
does not depend on desmos.com being up. The harness tests skip themselves when
no Chromium is installed.

## Scripts

| Command             | Description                                 |
| ------------------- | ------------------------------------------- |
| `pnpm build`        | Build every package in dependency order     |
| `pnpm dev`          | Build once, then watch every package        |
| `pnpm test`         | Build, then run the suites on `node --test` |
| `pnpm test:browser` | Download the Chromium the harness needs     |
| `pnpm typecheck`    | Typecheck everything, tests included        |
| `pnpm format`       | Rewrite with Prettier                       |
| `pnpm clean`        | Remove every `dist/` and `*.tsbuildinfo`    |

## License

[MIT](./LICENSE)
