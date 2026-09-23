# Changelog

Every package in Axis is released together, at one version, so this one file
covers all of them. A pull request adds its change under **Unreleased**, and
`node scripts/release.mjs <version>` turns that section into the release's own.

A breaking change - a file that compiled before and now errors or draws a
different graph, or an export that changed shape - is a major version. A new
function, property, statement or diagnostic is a minor one. A fix is a patch.

## Unreleased

### Added

- A diagnostic's code links to its entry in the
  [reference](https://jayson-clark.github.io/axis/reference/diagnostics/): in
  the hover in Monaco and the playground, and as LSP's `codeDescription` in
  VSCode and other editors. The language service puts the link on each
  diagnostic as `href`, and exports `diagnosticDocsUrl(code)` for a host that
  reports its own.

### Fixed

- The reference lists `invalid-color` once, with both the lexer's and the
  checker's meaning of it, instead of under two headings with the same name.

## 2.2.0 - 2026-09-23

### Added

- `theta-equation`: the checker reports `theta = …`, which Desmos refuses to
  graph in any mode, and suggests writing the curve as `r = …`.
- Sums, products and integrals: `sum(n = 1..10, n^2)`, `prod(k = 1..5, k)` and
  `int(t = 0..1, f(t))`, with either end of the range any expression. They
  compile to `\sum`, `\prod` and `\int`, and graphs from desmos.com that use
  them now decompile in full instead of as `// unsupported:` comments.
- Derivatives: `d/dx f(x)` differentiates the product after it, as Desmos does,
  and `f'(x)` and `f''(x)` differentiate a function.
- `log(x, b)`, the logarithm to base `b`, written `\log_{b}` in latex.
- `rebound-variable`: a `sum`, `prod` or `int` variable that is already a
  parameter, a binding, or the variable of a sum around it, which Desmos
  refuses.
- `expected-bounds`: `sum(`, `prod(` or `int(` not followed by
  `name = from..to`.
- `parseLatexStatement` in `@axis-dsl/compiler` reads latex as a row of the
  expression list, whose `=` takes everything after it, where `parseLatex`
  reads it as an expression.

### Changed

- **Breaking:** `sum`, `prod` and `int` are built-in names now, so a file that
  defines one - `sum = total(L)`, `int(x) = …` - reports `assign-to-builtin`.
  Rename the definition.
- **Breaking:** `d/dx` followed by an operand is a derivative. It used to be `d`
  divided by `dx` and multiplied by the operand, which only a file with
  variables named `d` and `dx` could have meant. `d/dx` with nothing after it
  is still that division.
- Axis is described as a language for Desmos graphs rather than a scripting
  language, and a `.axis` file as a file rather than a script, across the docs,
  the site, hover and the READMEs. The extension's display name is now
  **Axis — Desmos Graph Language**.
- Diagnostic messages that said "script" now say "file", such as "`config`
  belongs at the top level of a file". No diagnostic code changed.
- `@axis-dsl/harness` exports its loaded-source type as `LoadedSource`.
  `LoadedScript` remains as a deprecated alias.

### Fixed

- A definition whose value is a `with` or `for`, such as
  `g = a - b with a = 2, b = 3`, decompiles and writes back from the preview
  as it was written, instead of gaining brackets round its value.
- A graph that defines a palette name with a `with`, such as
  `RED = a with a = 1`, no longer has its colours decompiled as that name.

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
lockstep. Axis 1 read a file by rewriting its text in passes, and every pass had
to guess where the one before it had left things. Axis 2 reads it with a real
lexer and parser into a syntax tree, and everything - the compiler, the
formatter, the editor services, the decompiler - works on that tree.

### Changed

- **New syntax.** Metadata is `@` and `@{ … }` rather than `#` and `#{ … }`,
  which frees `#` for colours. Statements are separated by a newline or `;`,
  never a comma. A slider is a range, `-5..5 step 0.5`, rather than `min`,
  `max` and `step` properties. Colours may be palette names, a boolean property
  may be written bare, a folder may be untitled, a macro is `macro f(x) = …`
  with an `=`, and `style` is new.
- **No migrator.** A 1.x file has to be rewritten by hand; `examples/graphs`
  and the spec are the guide to what it becomes.
- **Precedence is a table, not an accident.** Every expression is emitted from
  the tree with exactly the brackets it needs, so `2^10` is 1024 and `4^2/2` is
  8 - both of which Axis 1 wrote as valid latex with a different value - and
  `1/2x`, `a/b^2` and `-x^2` all mean what the spec says they do.
- **Errors instead of silent miscompiles.** A misspelt function, a property in
  the wrong place, a colour Desmos would read as three variables, `dt` outside
  a ticker, a macro called with the wrong arguments - each is a diagnostic with
  a code and a span, where Axis 1 would compile it into a graph that quietly
  did something else.
- **Macros are expressions.** A macro is substituted into the tree, so it
  cannot capture a neighbouring operator - and can no longer stand for
  metadata, which is what styles are for.
