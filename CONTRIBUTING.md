# Contributing to Axis

Thanks for helping. This covers getting a checkout running, the loop for trying
a change, and what a pull request needs. The language itself is documented on
[the site](https://jayson-clark.github.io/axis/), and
[`docs/spec.md`](./docs/spec.md) is its specification.

## Setup

You need [Node](https://nodejs.org) 22 or later and [pnpm](https://pnpm.io) 11
or later (`corepack enable` picks up the `packageManager` field).

```sh
git clone https://github.com/jayson-clark/axis
cd axis
pnpm install
pnpm dev            # build every package, then watch them
pnpm test:browser   # download the Chromium the harness tests need, once
```

## Trying a change

- **In VSCode.** Open the repository and press <kbd>F5</kbd> (the "Extension"
  launch configuration) for an Extension Development Host with Axis loaded.
  Open a file from [`examples/`](./examples) and run **Axis: Preview Graph**.
  `pnpm --filter axis-dsl package` builds a `.vsix` to install in an everyday
  VSCode.
- **In a browser.** `pnpm site:dev` serves the docs site, whose playground is
  an editor beside a live graph, at `localhost:4321/axis/playground/`.
- **On a real calculator.** `node packages/harness/dist/cli.js <file.axis>`
  compiles a file, loads it into a headless Desmos, and prints what Desmos made
  of every expression. Use it on anything you change that reaches a graph: the
  compiler can only say what it emitted, not whether Desmos accepts it.
- **The docs site.** `pnpm site:dev` serves it at `localhost:4321/axis/`.

## Tests

```sh
pnpm test           # build, then every suite
pnpm typecheck      # everything, tests included
pnpm format         # prettier; CI runs format:check
```

A test that needs no calculator goes in `packages/<name>/test` for the package
it is about. A test about what Desmos _does_ with the result goes in
`packages/harness/test`. The [`desmos-harness`](./.claude/skills/desmos-harness/SKILL.md)
guide says which suite, and lists the Desmos behaviours that have caused bugs.

Some tests exist to make sure nothing is forgotten: a function or property in
the manifest with no test, a diagnostic code with no catalogue entry, an
example that does not compile back from its decompiled graph. When one fails,
add the missing piece rather than an exemption. The
[`language-change`](./.claude/skills/language-change/SKILL.md) guide lists
everything a change to the language touches, and
[`write-back`](./.claude/skills/write-back/SKILL.md) covers the decompiler and
writing graph changes back into a file.

## Pull requests

- **Add a line under Unreleased in [`CHANGELOG.md`](./CHANGELOG.md)** for
  anything a user of Axis would notice, under Added, Changed, Deprecated,
  Removed or Fixed. A change to CI, tests or internals needs none.
- **Leave the versions alone.** Every package is released together at one
  version, and it is set when a release is cut.
- **Avoid breaking changes.** A file that compiled before and now errors or
  draws differently, or an export that is removed or renamed, makes the next
  release a major version. Keep an old name as a `@deprecated` alias where you
  can.
- **Keep the docs honest.** Every ` ```axis ` block in the docs is compiled and
  drawn by the tests, so a change to the language that breaks one fails CI. If
  you change the language, change [`docs/spec.md`](./docs/spec.md) with it.
- **CI must pass**: formatting, types, and every suite, harness included.

## Style

Match the surrounding code. Comments explain _why_, in prose. Axis describes a
graph rather than running anything, so a `.axis` file is a _file_ (or
_source_), never a script, and Axis is "a language for Desmos graphs" anywhere
a user will read it.

## Releases

Releases are cut by the maintainer: see the
[`release`](./.claude/skills/release/SKILL.md) guide.

## Working with an AI agent

[`AGENTS.md`](./AGENTS.md) is the short version of this file for coding agents,
and the guides under [`.claude/skills/`](./.claude/skills) are the detail.
Claude Code loads both on its own; point any other agent at `AGENTS.md`.
