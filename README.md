<img src="assets/axis-banner.svg" alt="Axis" width="220">

**A language for [Desmos](https://www.desmos.com) graphs.** Write a `.axis`
file and it compiles to the expressions, folders, tables and settings a graph is
made of — with a VSCode extension that graphs it as you type.

```
config { showGrid: true; degreeMode: false }

style bold { lineWidth: 4 }
macro bell(s) = e ^ (-x ^ 2 / s)

"Basic functions"

f(x) = x ^ 2 - 4x + 3 @ color: RED
g(x) = sin(x) + cos(2x) @ color: BLUE, use: bold

a = 1 @ slider: 0.5..4 step 0.5
h(x) = bell(a) @{
    color: GREEN
    lineStyle: DASHED
    label: "a bell"
}

folder { table { x = [1, 2, 3]; y = [1, 4, 9] @ lines } }

n = 0
ticker n -> n + dt / 1000 @ playing
```

A statement ends at the newline after it, or at a `;` — inside a `folder`, a
`table`, a `config`, a `style` or an `@{ … }` block just as at the top level.
Inside an open bracket a newline ends nothing, so a long list or piecewise may
spread over as many lines as it likes.

`@` styles the statement it trails, `@{ … }` is the same properties with room
to breathe, one to a line, and a property that is true or false may be written
bare: `@ hidden`. A colour is a hex literal, one of Desmos' palette by name —
`RED`, `BLUE`, `GREEN`, `PURPLE`, `ORANGE`, `BLACK` — or any expression that
works one out, like `rgb(255, a, 0)`. A slider is a range, `lo..hi step s`, with
either end left off to keep Desmos' default for it and `soft` to let a typed
value past one.

A compiled file is a finished graph rather than an editor, so Axis opens one
without the chrome Desmos wraps around a graph at desmos.com: the settings
menu, the zoom buttons and the border are all off unless a `config` block asks
for them back (`zoomButtons: true`, and so on), and the expression list starts
collapsed — there to be opened, but out of the way until it is
(`expressionsCollapsed: false` opens it on load).

**[`docs/spec.md`](./docs/spec.md) is the reference** for all of it: every
statement, the precedence table, which property goes where, and every
diagnostic the compiler can report.

## Features

- **Plain text graphs** — version them, diff them, review them
- **Imports** — `import "./waves"` drops a whole file in, as a folder
- **Macros and styles** — `macro` names an expression, `style` names a run of
  metadata, and both are resolved away before Desmos sees the graph
- **Live preview** — the graph updates as you edit, and a point dragged or a
  slider moved in it is written back into the file
- **Editor support** — highlighting, completions, hover, formatting,
  diagnostics, go to definition, and paths that complete as you type them and
  open on a ctrl-click — in VSCode, or any editor with a language server client
- **Embeddable** — the compiler, the editor services and the viewer ship as npm
  packages

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
[`examples/graphs/`](./examples/graphs) and hit the graph button in the editor
title bar (or run **Axis: Preview Graph**). It asks whether to open in a Simple
Browser tab or your real browser — pin an answer to stop being asked, or set
`axis.previewTarget` back to `ask` to be asked again.

The preview is a page served over loopback, not a panel inside the editor, so it
never competes for a spot in the workbench and you can have as many open as you
have files. Each one is bound to the file you launched it from and reloads when
you save it, the same bargain a web dev server strikes. It works the other way
too: drag a point, move a slider or recolour a curve in the preview, and the
statement that drew it is rewritten in the editor, as an edit ctrl+z undoes.

The page is the graph and nothing else. Turn on `axis.preview.debug` and it
grows **Graph**/**JSON** tabs and the path it is showing — the JSON is the
compiled graph state, the settings, and what the calculator made of them.

While the server is up there is an `$(broadcast) Axis` item in the status bar.
Click it to reopen a preview whose tab you closed, serve another file, or stop
the server.

Those examples are a tour of the language, one topic per file - functions,
piecewise, styling, folders, sliders, lists, tables, parametric and polar
curves, inequalities, click actions, colours, config, imports, macros, images
and styles - plus four complete graphs to read as finished work.

The Axis project's Desmos API key is built in, so the graph works with no setup.
To use your own, [get a key](https://www.desmos.com/api) and set `axis.apiKey`
in VSCode settings.

## Imports

`import` drops the whole of another file into this one, in a folder of its
own — the way to keep a long graph in several files, and to reuse one across
graphs.

```
import "./lib/waves"                      // a folder called "waves"
import "./lib/waves.axis" as "Waves"      // …or called whatever you like
import "./lib/waves" @ collapsed: false   // styled like any other folder
```

The path is relative to the file the import is written in — a leading `/` is
relative to the workspace instead — and the `.axis` may be left off.

An imported file is **flattened**: whatever folders it organises itself with are
dropped, and everything they held joins the one folder the import makes. That
holds all the way down, so a file that imports a file that imports a file still
arrives as one flat folder. Desmos has one level of folders, and the import has
claimed it — which is also why an import written inside a folder joins that
folder rather than opening another. An import's folder starts collapsed, since
what is in it is written and read elsewhere.

The rest travels with it: an imported file's `config` applies too, with the
importing file's settings winning wherever the two disagree, and its macros
and styles are in scope in the file that imports it. A file imported twice is
included once, since a second copy would define every name in it again. A file
that imports itself, however indirectly, is an error rather than a hang.

A preview watches everything the file imports, so saving any file the graph is
built from reloads it. The path completes as it is typed, a directory at a time,
and ctrl-clicking it opens the file it names.

## Tickers

A ticker runs one action over and over for as long as the graph is open — the
way a graph animates something a slider cannot.

```
n = 0
clock = 0

// Every 50ms, and running from the moment the graph opens.
ticker n -> mod(n + 1, 60), clock -> clock + dt @ minStep: 50, playing
```

`minStep` is the shortest gap between two ticks, in milliseconds; leave it out
and Desmos ticks once a frame. `playing` starts it on load, and `open` shows the
ticker expanded in Desmos' expression list. Inside the handler `dt` is the
milliseconds since the last tick, which is how a graph keeps real time however
late the ticks come; anywhere else it is an error.

A graph has exactly one ticker, and Desmos keeps it beside the expression list
rather than in it — so the statement goes at the top level, outside every
folder, and `compileAxis` hands it back as the state's `expressions.ticker`
rather than as an expression. It also switches `actions` on for you: Desmos
decides that setting by looking at the expression list alone, so a graph whose
only action is its ticker would otherwise never tick.

## Macros and styles

A macro is an expression with a name. Wherever the name appears it is replaced
by that expression, so nothing about it reaches Desmos — the graph is the one
you would have written out by hand.

```
macro TAU = 6.283185
macro wave(k, phase) = sin(k * x + phase)

y = wave(1, 0) + wave(2, TAU / 4)
```

Without a parameter list a macro stands for one expression, and is used without
brackets; with one, it takes arguments and puts them into its body. The
substitution is made on the parsed expression rather than on its text, so an
argument keeps its own grouping without brackets: `wave(1 + 2, 0)` is
`sin((1 + 2) * x)`, never `sin(1 + 2 * x)`.

A macro is in scope for the whole compilation — the lines above its definition,
and every file that imports the one defining it or that it imports — so a file
of nothing but macros is a library. Two definitions of one name are an error, as
is a macro named after a builtin or a name the file defines, one used with the
wrong number of arguments, and one that expands into itself.

A macro stands for an expression and nothing else — never a statement, a block
or a run of metadata. Metadata written once and used on many statements is a
**style**:

```
style swatch { pointSize: 14; showLabel }
style loud { use: swatch; color: RED }

(-2, 1) @ use: swatch, color: BLUE, label: "one"
(0, 1) @ use: loud, label: "two"
```

`use:` applies a style as if its properties had been written there. A style may
use other styles, one clause may use several — they apply in the order written,
so where two disagree the later wins — and a property the clause writes itself
beats every style it uses. A style is checked where it is used, too, so a
property it sets that the statement using it does not take is reported against
the `use:`. Like macros, styles are in scope everywhere, across imports.

Because the graph holds what a macro expanded to rather than the call, a
statement with an expansion in it is not written back from the preview; one
that uses a style is, since the `use:` is source like anything else.

## Images

An image is a statement carrying the picture itself, styled the way everything
else is — and every measurement is an expression, so an image can be centred on
a point the graph works out and sized by a slider.

```
image "./photos/beach.jpg" @ name: "Reference", center: (0, 1), width: 10, height: 6.7
image "https://example.com/beach.jpg" @ center: (3, 2), angle: -pi / 200, opacity: 0.5, foreground
image "data:image/png;base64,iVBOR…" @ width: 4, height: 4
```

`name` is the caption the expression list shows, `foreground` draws the image
over the graph rather than under it, `angle` turns it anticlockwise in radians,
and `hidden`, `secret`, `dragMode` and `onClick` mean what they do everywhere
else.

The three spellings above are the three things an image may name. A **file** is
named the way an import names one — relative to the file, or from the
workspace root with a leading `/` — and is read at compile time and inlined as a
`data:` URI. A path is only a path on the machine the file was written on, and
a graph has to carry its pictures with it, so the file travels with it. A
**URL** is left alone for Desmos to fetch, and a **`data:` URI** is passed
straight through, which is how Desmos itself stores an image somebody dropped
onto a graph.

Png, jpg, gif, webp, svg, bmp, ico, apng and avif are read; anything else is an
error rather than a file a browser is left to guess at. The editor treats a
picture exactly as it does an import: it completes the path, underlines one that
is not there, opens the file on a ctrl-click, and reloads the preview when one
is saved.

## Use it in your own app

```sh
npm install @axis-dsl/compiler @axis-dsl/language-service @axis-dsl/viewer monaco-editor react react-dom
```

Compile anywhere — a build step, a server, a test:

```ts
import { compileAxis } from '@axis-dsl/compiler';

const { state, options, diagnostics } = compileAxis(source);

calculator.setState(state);
calculator.updateSettings(options);
```

That is the whole of applying a graph: `state` is everything `setState` takes —
the expression list, the ticker, the viewport, the top-level flags — and
`options` is everything `updateSettings` takes. `compileAxis` never throws on its
source: whatever is wrong with it comes back in `diagnostics`, each with a
stable `code`, a severity and a `span`, beside the graph the rest of it still
makes. It also hands back a `sourceMap` from every item in the graph to the
statement that wrote it, which is what `writeBackGraph` uses to turn a change
made on the calculator into an edit to the file.

Compilation is synchronous and touches no filesystem, so a file with imports
or pictures is handed resolvers. `loadImports` and `loadImages` walk the graph
first, over whatever reading a file means where you are — `node:fs`, a VSCode
workspace, a `Map`:

```ts
import {
    compileAxis,
    createImageResolver,
    createImportResolver,
    loadImages,
    loadImports,
} from '@axis-dsl/compiler';
import { withAxisExtension } from '@axis-dsl/syntax';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const sources = {
    resolve: (specifier, from) => resolve(dirname(from), withAxisExtension(specifier)),
    read: path => readFile(path, 'utf8'),
};
const pictures = {
    resolve: (url, from) => resolve(dirname(from), url),
    read: async path => new Uint8Array(await readFile(path)),
};

const files = await loadImports({ path, source }, sources);
const images = await loadImages({ path, source }, files, pictures);
const { state, options, diagnostics, dependencies } = compileAxis(source, {
    path,
    resolveImport: createImportResolver(files, sources.resolve),
    resolveImage: createImageResolver(images, pictures.resolve),
});
```

`dependencies` names every file that was read — `imports` and `images` — which
is what to watch if the graph is live. `@axis-dsl/harness` exports this very
host for Node as `readAxisFile`.

To edit Axis, hand your own Monaco instance to `registerAxisLanguage`. It adds
highlighting, completions, hover, formatting, diagnostics, go to definition and
the outline, plus the `axis-dark` and `axis-light` themes, and is idempotent per
instance:

```ts
import {
    registerAxisLanguage,
    AXIS_LANGUAGE_ID,
    AXIS_DARK_THEME,
} from '@axis-dsl/language-service/monaco';
import * as monaco from 'monaco-editor';

registerAxisLanguage(monaco);

monaco.editor.create(container, {
    value: 'y = x ^ 2 @ color: RED',
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
import { useMemo } from 'react';
import { compileAxis } from '@axis-dsl/compiler';
import { AxisViewer, useLocalViewerHost } from '@axis-dsl/viewer';

function Graph({ source }) {
    const { state, options } = useMemo(() => compileAxis(source), [source]);
    const transport = useLocalViewerHost({ apiKey: MY_DESMOS_KEY, state, options });

    return <AxisViewer transport={transport} />;
}
```

The viewer is the graph alone — add `debug` for the **Graph**/**JSON** tabs and
the status line, which is what the playground does and what the extension's
`axis.preview.debug` turns on. Give `useLocalViewerHost` an `onGraphChanged`
and it reports every change made to the graph by hand, ready for
`writeBackGraph`.

React 19 is a peer dependency of the viewer, and the Monaco wiring works on the
instance you hand it (0.56+) rather than bundling one, so your app owns both.
`examples/web` is a runnable Vite app wiring all of this up.

## Other editors

Everything the VSCode extension knows about a file comes from
[`@axis-dsl/language-server`](./packages/language-server), and any editor with a
Language Server Protocol client can use it the same way — Neovim, Helix, Zed,
Emacs, Sublime:

```sh
npm install --global @axis-dsl/language-server
axis-language-server --stdio
```

Its README has the capabilities, the settings it reads and a configuration for
several editors. What only the extension has is the live preview.

## Packages

| Package                      | Purpose                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `@axis-dsl/syntax`           | The lexer, parser and printer, the manifest of every name the language knows   |
| `@axis-dsl/compiler`         | `.axis` source to a Desmos graph state, the decompiler back, and write-back    |
| `@axis-dsl/language-service` | Completions, hover, formatting, diagnostics, navigation, and the Monaco wiring |
| `@axis-dsl/language-server`  | The language service over LSP, with imports and images read off disk           |
| `@axis-dsl/viewer`           | The results panel, and the protocol a host drives it with                      |
| `@axis-dsl/desmos`           | The Desmos calculator API, typed by hand                                       |
| `@axis-dsl/harness`          | Runs a file against a real headless Desmos                                     |
| `axis-dsl`                   | The VSCode extension                                                           |

Every package is released together, at one version.

## Testing against a real Desmos graph

The compiler can only tell you what it emitted.
[`@axis-dsl/harness`](./packages/harness) tells you what Desmos made of it: it
loads a file into a real calculator in a headless Chromium and hands back the
graph state, the expression list, and Desmos' own verdict on every expression.

```sh
pnpm test:browser   # download Chromium, once
```

```sh
$ npx axis-inspect examples/graphs/16-imports.axis
16-imports.axis — 15 expressions, 0 diagnostics, 0 errors

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

## What changed in 2.0

Axis 1 read a file by rewriting its text in passes, and every pass had to
guess where the one before it had left things. Axis 2 reads it with a real
lexer and parser into a syntax tree, and everything — the compiler, the
formatter, the editor services, the decompiler — works on that tree. What that
changes for a file:

- **New syntax.** Metadata is `@` and `@{ … }` rather than `#` and `#{ … }`,
  which frees `#` for colours. Statements are separated by a newline or `;`,
  never a comma. A slider is a range, `-5..5 step 0.5`, rather than `min`,
  `max` and `step` properties. Colours may be palette names, a boolean property
  may be written bare, a folder may be untitled, a macro is `macro f(x) = …`
  with an `=`, and `style` is new.
- **No migrator.** A 1.x file has to be rewritten by hand;
  [`examples/graphs`](./examples/graphs) and the spec are the guide to what it
  becomes.
- **Precedence is a table, not an accident.** Every expression is emitted from
  the tree with exactly the brackets it needs, so `2^10` is 1024 and `4^2/2` is
  8 — both of which Axis 1 wrote as valid latex with a different value — and
  `1/2x`, `a/b^2` and `-x^2` all mean what [the spec](./docs/spec.md#51-precedence)
  says they do.
- **Errors instead of silent miscompiles.** A misspelt function, a property in
  the wrong place, a colour Desmos would read as three variables, `dt` outside
  a ticker, a macro called with the wrong arguments — each is a diagnostic with
  a code and a span, where Axis 1 would compile it into a graph that quietly
  did something else.
- **Macros are expressions.** A macro is substituted into the tree, so it
  cannot capture a neighbouring operator — and can no longer stand for
  metadata, which is what styles are for.

## Scripts

| Command                              | Description                                     |
| ------------------------------------ | ----------------------------------------------- |
| `pnpm build`                         | Build every package in dependency order         |
| `pnpm dev`                           | Build once, then watch every package            |
| `pnpm test`                          | Build, then run the suites on `node --test`     |
| `pnpm test:browser`                  | Download the Chromium the harness needs         |
| `pnpm typecheck`                     | Typecheck everything, tests included            |
| `pnpm format`                        | Rewrite with Prettier                           |
| `pnpm clean`                         | Remove every `dist/` and `*.tsbuildinfo`        |
| `node scripts/version.mjs <version>` | Set every package to one version, for a release |

## License

[MIT](./LICENSE)
