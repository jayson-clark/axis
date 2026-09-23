# Changelog

Every package in Axis is released together, at one version, so this one file
covers all of them. A pull request adds its change under **Unreleased**, and
`node scripts/release.mjs <version>` turns that section into the release's own.

A breaking change - a file that compiled before and now errors or draws a
different graph, or an export that changed shape - is a major version. A new
function, property, statement or diagnostic is a minor one. A fix is a patch.

## Unreleased

### Changed

- Axis is described as a language for Desmos graphs rather than a scripting
  language, and a `.axis` file as a file rather than a script, across the docs,
  the site, hover and the READMEs. The extension's display name is now
  **Axis — Desmos Graph Language**.
- Diagnostic messages that said "script" now say "file", such as "`config`
  belongs at the top level of a file". No diagnostic code changed.
- `@axis-dsl/harness` exports its loaded-source type as `LoadedSource`.
  `LoadedScript` remains as a deprecated alias.

## 2.1.1-rc.0 - 2026-09-23

Releases are published from CI

## 2.1.0 - 2026-09-22

### Added

- A documentation site, built with Starlight and published to GitHub Pages, with
  a guide, a playground, a page for every example and a reference generated
  from the language itself.
- Every function, operator and property in the manifest carries an `example`
  and, where its one-line `detail` is not enough, `documentation`. Hover and
  completions show both.
- `SYNTAX_DIAGNOSTICS`, `COMPILER_DIAGNOSTICS` and `DECOMPILER_DIAGNOSTICS`
  declare every diagnostic code with a summary and an example that raises it.

### Changed

- The extension, the harness and `@axis-dsl/desmos` use the Axis project's
  Desmos API key in place of the demo key.

## 2.0.0

The second version of the language, and the first release of every package in
lockstep.
