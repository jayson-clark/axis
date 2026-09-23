<img src="assets/axis-banner.svg" alt="Axis" width="220">

**A language for [Desmos](https://www.desmos.com) graphs.** Write a `.axis`
file and it compiles to the expressions, folders, tables and settings a graph is
made of, with editor support and a live preview that graphs it as you type.

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

**[Read the docs](https://jayson-clark.github.io/axis/)** ·
[Try it in the playground](https://jayson-clark.github.io/axis/playground/) ·
[Getting started](https://jayson-clark.github.io/axis/start/installation/) ·
[Reference](https://jayson-clark.github.io/axis/reference/)

## Features

- **Plain text graphs** - version them, diff them, review them
- **Imports, macros and styles** - split a graph across files, name an
  expression, name a run of styling
- **Live preview** - the graph updates as you edit, and a point dragged or a
  slider moved in it is written back into the file
- **Editor support** - highlighting, completions, hover, formatting,
  diagnostics and go to definition, in VSCode or any editor with a language
  server client
- **Checked against real Desmos** - the compiler reports what Desmos would
  silently get wrong, and a headless harness runs a file on a real calculator
- **Embeddable** - the compiler, the editor services and the viewer ship as npm
  packages

## Packages

| Package                                                     | What it is                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`axis-dsl`](./packages/extension)                          | The VSCode extension: language support and the live preview            |
| [`@axis-dsl/compiler`](./packages/compiler)                 | Axis source to a Desmos graph state, the decompiler back, write-back   |
| [`@axis-dsl/syntax`](./packages/syntax)                     | The lexer, parser and printer, and the manifest of every name          |
| [`@axis-dsl/language-service`](./packages/language-service) | Completions, hover, formatting and diagnostics, and the Monaco wiring  |
| [`@axis-dsl/language-server`](./packages/language-server)   | The language service over LSP, for Neovim, Helix, Zed and the rest     |
| [`@axis-dsl/viewer`](./packages/viewer)                     | A React component for a live graph, and the protocol a host drives     |
| [`@axis-dsl/desmos`](./packages/desmos)                     | The Desmos calculator API, typed                                       |
| [`@axis-dsl/harness`](./packages/harness)                   | Runs a file on a real headless Desmos calculator, for tests and agents |

Each package's README covers its API. The docs site's
[playground](./docs/site/src/components/Playground.tsx) is an app that embeds
the editor and the graph.

## Contributing

[`CONTRIBUTING.md`](./CONTRIBUTING.md) covers setup, the dev loop and what a
pull request needs; [`CHANGELOG.md`](./CHANGELOG.md) is what changed in each
release.

## License

[MIT](./LICENSE)
