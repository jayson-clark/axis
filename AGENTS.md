# Working on Axis

Axis is a declarative DSL that compiles to Desmos graphs. `.axis` source in,
the expressions/folders/tables/settings a graph is made of out.
[`docs/spec.md`](./docs/spec.md) is the language: where the code and it
disagree, one of them is a bug.

Nothing in a `.axis` file runs: it describes a graph, and Desmos does any
running. So Axis is not a scripting language and a `.axis` file is not a
script. Call it a _file_, or its _source_ where it isn't on disk, and write "a
language for Desmos graphs" wherever a user will read it.

## Guides

The detail lives in guides, one per kind of work. Claude Code loads them as
skills; any other agent should read the file before starting that kind of work.

| Guide                                                          | Read it when                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`desmos-harness`](./.claude/skills/desmos-harness/SKILL.md)   | touching anything that ends up in a graph, or writing a test against a calculator   |
| [`language-change`](./.claude/skills/language-change/SKILL.md) | adding or changing a function, property, statement, diagnostic or latex rule        |
| [`write-back`](./.claude/skills/write-back/SKILL.md)           | working on the decompiler, the source map, or writing a graph's changes into a file |
| [`release`](./.claude/skills/release/SKILL.md)                 | cutting a release, or deciding what version the next one is                         |

[`CONTRIBUTING.md`](./CONTRIBUTING.md) is the same ground for people: setup,
the dev loop, and what a pull request needs.

## Packages

| Package                         | What lives there                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@axis-dsl/syntax`              | The lexer, the parser and its tree, the printer (`format`), the manifest, what a path names         |
| `@axis-dsl/compiler`            | Checking, macros, styles, lowering and latex; the decompiler and write-back going the other way     |
| `@axis-dsl/language-service`    | Completions, hover, formatting, diagnostics, navigation, semantic tokens, and the Monaco wiring     |
| `@axis-dsl/language-server`     | The language service over LSP, with imports and images read off disk                                |
| `@axis-dsl/viewer`              | React components - the graph and the JSON inspector - and, under `./protocol`, the messages to them |
| `@axis-dsl/desmos`              | The Desmos calculator API, typed by hand                                                            |
| `@axis-dsl/harness`             | Runs a file against a real headless Desmos calculator                                               |
| `axis-dsl` (extension)          | The VSCode extension: an LSP client for the server, and the preview                                 |
| `@axis-dsl/site` (`docs/site/`) | The docs site: Astro Starlight, its reference generated from the manifest and the catalogues        |

The layering is syntax ← compiler ← language-service ← language-server, each
using only what is to its left - so something the compiler and the editor both
need belongs in syntax or the compiler, never in the language service.

Forwards, a file goes `lexer.ts` → `parser.ts` (both in syntax) → the
compiler's `program.ts` → `symbols.ts` → `check.ts` → `macros.ts` and
`styles.ts` → `lower.ts`, with `latex/emit.ts` writing each expression.
Backwards, `latex/parse.ts` → `decompile.ts` → `readback.ts` and
`writeback.ts`. Both directions print through syntax's `print.ts`, so generated
source is laid out exactly as the formatter would lay it out.

## Commands

```sh
pnpm build          # build every package in dependency order
pnpm test           # build, then run every suite on node --test
pnpm typecheck      # everything, tests included
pnpm format         # prettier
pnpm format:check   # prettier, without writing
pnpm test:browser   # download the Chromium the harness needs (once)
pnpm site:dev       # the docs site, live, at localhost:4321/axis/
pnpm site:build     # the docs site, built into docs/site/dist
pnpm --filter axis-dsl test:vscode   # the extension, in a real VSCode it downloads
node packages/harness/dist/cli.js <file.axis>   # a file, on a real calculator
```

Tests run against each package's built `dist/`, so **build before testing** -
`pnpm test` does it for you. CI runs `format:check`, `typecheck` and `pnpm test`
on every pull request, and the release runs them again before it publishes.

## What every change owes

- **A real calculator's opinion.** The compiler can only say what it emitted,
  not whether Desmos accepts it, and that gap is where the bugs have been. Run
  anything that reaches a graph through the harness. → `desmos-harness`
- **A test where it belongs.** Anything that needs no calculator goes in the
  package it is about (`packages/<name>/test`); anything about what Desmos
  _does_ with the result goes in `packages/harness/test`.
- **The rest of the language, kept in step.** A name in the manifest needs a
  harness test and an example; a diagnostic code needs a catalogue entry and
  the spec's table; a compile rule needs its decompile rule and its source map.
  The guard tests fail when one is missing, and the fix is the missing piece,
  not an exemption. → `language-change`, `write-back`
- **A code block in the docs is a claim about the language.** Every ` ```axis `
  block written by hand - on the site, in the spec, in `KEYWORD_INFO` - is
  compiled clean and drawn on a calculator. One that shows a mistake says so,
  ` ```axis error="unknown-function" `; a fragment that is not a whole file gets
  a plain fence.
- **A line in the changelog, and the versions left alone.** Anything a user of
  Axis would notice gets a line under **Unreleased** in `CHANGELOG.md`. Versions
  are set only when a release is cut. → `release`

## Style

Match the surrounding code. Comments explain _why_, in prose, and the existing
files are the reference for how much of it to write - see
`packages/compiler/src/compile.ts` or `packages/harness/src/page.ts`.
