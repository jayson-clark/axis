---
title: Getting started
description: The VSCode extension, the in-browser playground, and the command-line harness.
sidebar:
  order: 1
---

There are three ways to graph a file: in VSCode, with a live preview beside it;
in a browser, in the playground; and from a terminal, against a real headless
Desmos calculator. All three compile with the same compiler, so a file that
works in one works in the others.

Everything here is built from a checkout of the repository, which needs
[Node](https://nodejs.org) 22 or later and [pnpm](https://pnpm.io) 11 or later
(`corepack enable` picks up the `packageManager` field):

```sh
git clone https://github.com/jayson-clark/axis
cd axis
pnpm install
pnpm dev
```

`pnpm dev` builds every package once and then watches them; `pnpm build`
builds them once and stops.

## VSCode

Open the repository in VSCode and press <kbd>F5</kbd> (the "Extension" launch
configuration) to start an Extension Development Host with Axis loaded. Open
any file from `examples/` in it - they are a tour of the language, one
topic per file - and the language support starts straight away: diagnostics as
you type, completion of keywords, properties, names and paths, hover, go to
definition (into imported files too), formatting, and the outline.

`pnpm --filter axis-dsl package` builds the extension as a `.vsix` instead, to
install in an everyday VSCode.

### The preview

Run **Axis: Preview Graph**, or press the graph button in the editor title
bar. The preview opens in a Simple Browser tab or your own browser; it asks
which, and pinning an answer stops it asking. The preview is a page served over
loopback rather than a panel inside the editor, so there can be as many open
as there are files, each bound to the file it was launched from. It reloads
when that file is saved, or any file it imports or draws.

It works the other way too. Drag a point, move a slider, recolour a curve or
pan the graph in the preview, and the statement that drew it is rewritten in
the editor - unsaved, as an edit <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes. Only the
statement that changed is rewritten, so the comments and layout around it stay
as they were. A change is not written while the file has edits the preview
has not seen (save first), when it belongs to an imported file, or when it
lands on a statement a macro expanded into; the reason goes to the **Axis**
output channel and briefly to the status bar.

While the preview server is running there is an **Axis** item in the status
bar. Click it to reopen a preview whose tab was closed, serve another file, or
stop the server.

### Settings

| Setting                     | Meaning                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `axis.apiKey`               | Your Desmos API key. Left blank, the Axis project's own key is used. |
| `axis.previewTarget`        | `ask`, `editor` or `browser`: where a preview opens.                 |
| `axis.preview.debug`        | Show the preview's **Graph** and **JSON** tabs and the file's path.  |
| `axis.format.maxLineLength` | The column the formatter breaks a long line at. `0` never breaks.    |

The project's key is built in, so a preview works with no setup at all. To use
your own, [get a key from Desmos](https://www.desmos.com/api) and set
`axis.apiKey`. The **JSON** tab that `axis.preview.debug` adds shows the
compiled graph state, the settings, and what the calculator made of them.

### Other editors

Everything the extension knows about a file comes from the Axis language
server, and any editor with a Language Server Protocol client - Neovim, Helix,
Zed, Emacs, Sublime - can use it the same way:

```sh
npm install --global @axis-dsl/language-server
axis-language-server --stdio
```

From a checkout, `node packages/language-server/dist/bin.js --stdio` runs the
same server. What only the VSCode extension has is the live preview.

## The playground

The quickest way to try Axis needs no checkout at all: the
[playground](../../playground/) on this site, where every example on these
pages also opens with its "Open in playground" link. From a checkout, the
docs site runs locally with the playground in it:

```sh
pnpm site:dev
```

Edit on the left and the graph updates on the right; drag something on the
right and the source on the left catches up, exactly as in the VSCode preview.
It is also the example to copy for embedding Axis in an app of your own -
`docs/site/src/components/AxisEditor.tsx` is a short React wrapper around
Monaco, and `docs/site/src/components/monaco.ts` shows the loading and worker
setup.

## The command line

The compiler can only say what it emitted, not whether Desmos accepts it.
`axis-inspect`, from `@axis-dsl/harness`, loads a file into a real Desmos
calculator in a headless Chromium and prints the compiler's diagnostics beside
the verdict Desmos reached on every expression. It needs that Chromium
downloaded once:

```sh
pnpm test:browser
```

and is then run on a file:

```sh
node packages/harness/dist/cli.js examples/06-sliders-and-animation.axis
```

```
06-sliders-and-animation.axis — 25 expressions, 0 diagnostics, 0 errors

  0  text       Sliders
  1  ok         a=1 = 1
  2  ok         b=0 = 0
  3  ok         c=1 = 1
  …
```

Outside this repository, `npm install --save-dev @axis-dsl/harness` and
`npx playwright-core install chromium` set it up, and the command is
`npx axis-inspect`. Its options:

```sh
axis-inspect <file.axis>          # a file, imports and images resolved from disk
axis-inspect -e 'y = x^2'         # source inline
axis-inspect - < graph.axis       # source on stdin
  --json                          # the whole inspection, machine-readable
  --errors-only                   # only what Desmos rejected
  --eval '<expr>'                 # also evaluate an Axis expression (repeatable)
  --screenshot out.png            # write a PNG of the graphpaper
  --api-key <key>                 # default: the Axis project's key
  --offline                       # fail rather than fetch from desmos.com
```

It exits `1` if the compiler reported an error or Desmos put any expression in
error, so it works as a check in CI, or for an agent, without anybody parsing
its output. `--eval` takes Axis rather than latex: `--eval 'amp'` asks about the
variable the file calls `amp`.

The first run fetches Desmos' `calculator.js` and caches it on disk, so later
runs need no network at all.
