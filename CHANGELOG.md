# Changelog

Every package in Axis is released together, at one version, so this one file
covers all of them. A pull request adds its change under **Unreleased**, and
`node scripts/release.mjs <version>` turns that section into the release's own.

A breaking change - a file that compiled before and now errors or draws a
different graph, or an export that changed shape - is a major version. A new
function, property, statement or diagnostic is a minor one. A fix is a patch.

## Unreleased

### Added

- `config { calculator: GEOMETRY }` and `calculator: GRAPHING_3D` draw a graph
  on the Desmos geometry or 3D calculator instead of the graphing one. The
  viewer, the preview, the playground and the harness build whichever the
  graph asks for, and decompiling a geometry or 3D graph writes the
  `calculator` back. Only what the graphing calculator draws is supported so
  far: nothing specific to geometry or 3D is in the language yet.
- `@axis-dsl/desmos` types the `Desmos.Geometry` and `Desmos.Calculator3D`
  constructors, and exports `DesmosProduct`, `stateProduct` and
  `DESMOS_PRODUCT_CONSTRUCTORS` for building the calculator a state belongs to.
- The inverse hyperbolic functions `arcsinh`, `arccosh`, `arctanh`, `arccsch`,
  `arcsech` and `arccoth`, and the error function `erf` (#62).
- The statistics `quantile`, `quartile`, `cov`, `covp`, `corr`, `spearman` and
  `tscore` (#63).
- The complex-number functions `real`, `imag`, `conj` and `arg` (#68). Outside
  complex mode Desmos rejects them, and the new `requires-complex-mode`
  diagnostic says so first.
- The expression properties `labelAngle`, `interactiveLabel`,
  `editableLabelMode` and `displayEvaluationAsFraction`, which the decompiler
  and write-back read back as well (#69).
- Decompiling reads the other spellings Desmos accepts for a function as the
  name Axis has for it: `arsinh` as `arcsinh`, `inverseCdf` as `quantile`,
  `TScore` as `tscore`, and so on.
- `examples/20-complex-numbers.axis`.
- A member can be called: `D.cdf(1)`, `L.quantile(0.5)`, `T.conf(0.95)` - the
  function called with the member's target first, as Desmos writes it.
- The distributions `normaldist`, `tdist`, `chisqdist`, `uniformdist`,
  `binomialdist`, `poissondist` and `geodist`, with `pdf` and `cdf` (#64).
- The hypothesis tests `ttest`, `ztest`, `zproptest`, `chisqtest` and
  `chisqgof`, and their members `score`, `pleft`, `pright`, `dof`, `estimate`,
  `stderr`, `conf`, `null`, `lower` and `upper` (#65). The decompiler reads
  `ittest`, the old name of the two-sample test, as `ttest`.
- The geometry functions (#67): `segment`, `line`, `ray`, `vector`, `circle`,
  `arc`, `glider`, `parallel`, `perpendicular`, `intersection`,
  `strictintersection`, `angle`, `directedangle`, `angles`, `directedangles`,
  `anglebisector`, `coterminal`, `supplement`, `center`, `radius`, `area`,
  `perimeter`, `start`, `end`, `vertices`, `segments`, `translate`, `rotate`,
  `dilate` and `reflect` on the geometry calculator, and `triangle` and
  `sphere` on the 3D one. The new `requires-calculator` diagnostic reports one
  used on a calculator that lacks it.
- Geometry tokens: `$12` is the `\token{12}` the geometry calculator names a
  construction with. A token's definition is compiled into the calculator's
  hidden folder, where Desmos accepts it, so a graph built on the geometry
  calculator decompiles to a file that builds it again.
- `examples/21-geometry.axis`, and a Geometry page in the guide.
- Regressions (#70): `ys ~ m xs + b` fits a model's parameters to data, with
  `residuals: e1` naming the list its residuals go in and `logMode` fitting in
  log space. The decompiler reads a graph's regressions back, and write-back
  does not count Desmos refitting one as a change to the file.
- Charts (#66): `histogram`, `dotplot`, `boxplot` and `stats`, with the
  properties `binAlignment`, `histogramMode`, `dotplotXMode`, `alignedAxis`,
  `axisOffset`, `breadth` and `showBoxplotOutliers`.
- The `statement-only` diagnostic, for a chart or a regression written
  anywhere but as a statement of its own, and the `name` value type, for a
  property that takes a name.

- `×` is Desmos' `\times`: multiplication for numbers, and the cross product of
  two 3D points, where `*` is their dot product. A graph's `\times` used to be
  read as `*`, which turned every cross product into a dot product.
- A slice may leave an end off: `L[2...]`, `L[...3]`, `L[[2, 4...]]`, as Desmos
  allows in an index. Anywhere else a range still needs both ends, reported as
  `open-range` (#76).
- A blank table cell is an empty slot, `y = [4, , 6]`, which only a column's
  values may hold (`misplaced-blank`). The decompiler writes one instead of
  `0 / 0` (#80).
- The properties `inFrontOfEverything` (folder), `showAngleLabel`,
  `disableGraphInteractions` (expression and image) and `cdf` (a
  distribution's shaded probability, `cdf: -1..1`). A table's own regression
  is decompiled as the `~` statement that fits the same (#81).
### Changed

- **Breaking:** the geometry functions' names are built in, so a file that
  defines `area`, `center`, `radius`, `angle`, `line`, `start`, `end`,
  `vector`, `segment`, `circle` or any other of them now reports
  `assign-to-builtin`. Rename the definition. `examples/02-functions.axis`
  renames its `area(w, h)` to `rectArea(w, h)`.

### Fixed

- `DesmosEnabledFeatures` names the geometry calculator `GeometryCalculator`,
  as Desmos does, rather than `Geometry`.
- `config { allowComplex: true }` puts the graph in complex mode. It used to
  write only the calculator option, which permits complex mode without turning
  it on, so `sqrt(-1)` stayed undefined. A file that says `allowComplex: true`
  now draws in complex mode. The decompiler writes `allowComplex` only for a
  graph that is in complex mode.
- A definition whose value has `with` bindings is written without brackets, as
  Desmos writes it. In brackets a run of actions could read as a point (#78).
- `1.y` in a graph's latex is read as 1 times `y`, as Desmos reads it, not as
  a member of 1 (#79).
- A function parameter, a `with` or `for` binding or a `sum` variable named
  after a built-in is `assign-to-builtin`, since Desmos refuses each (#77).
- Decompiling reads `\pm` and `\mp`, which Desmos treats as names, as `pm`
  and `mp`; a colour with space round it or written `rgb(…)` as its hex; and
  leaves out a table column with nothing in it, and a slider's empty bounds
  (#82).
- A `with` ending a piecewise is written without brackets, as Desmos writes it.
- Decompiling reads more of what real graphs hold: a curve over an interval of
  its own parameter, `(…) for 0 < a < 2`, as the same curve in `t` over that
  domain (they draw identically); `\pm` bound by a `for`; a power of a member,
  `L^{2}.total^{-.5}`; a table cell holding only a space as blank; and `gcf`,
  Desmos' other name for `gcd`.
- Decompiled source compiles to latex that decompiles to the same source: a
  product with a number on its right is written `*`, and brackets that only
  group a script or a `with` inside a `for` are dropped (#83).
- Decompiling reads a number with nothing after its point, `3.`, which Desmos
  accepts and keeps as typed, as the number it is rather than leaving the
  expression out; and a number with its digits grouped, `20\ 000`, as twenty
  thousand rather than 20 times 0.
- The harness waits for Desmos to analyze every expression before it counts a
  graph as settled. A big graph on a slow machine could go quiet before Desmos
  had analyzed any of it, so every expression read as having no analysis.

## 2.3.0 - 2026-09-23

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
