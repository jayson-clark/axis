# Working on Axis

Axis is a scripting language that compiles to Desmos graphs. `.axis` source in,
the expressions/folders/tables/settings a graph is made of out.
[`docs/spec.md`](./docs/spec.md) is the language: where the code and it
disagree, one of them is a bug.

## Packages

| Package                         | What lives there                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@axis-dsl/syntax`              | The lexer, the parser and its tree, the printer (`format`), the manifest, what a path names         |
| `@axis-dsl/compiler`            | Checking, macros, styles, lowering and latex; the decompiler and write-back going the other way     |
| `@axis-dsl/language-service`    | Completions, hover, formatting, diagnostics, navigation, semantic tokens, and the Monaco wiring     |
| `@axis-dsl/language-server`     | The language service over LSP, with imports and images read off disk                                |
| `@axis-dsl/viewer`              | React components - the graph and the JSON inspector - and, under `./protocol`, the messages to them |
| `@axis-dsl/desmos`              | The Desmos calculator API, typed by hand                                                            |
| `@axis-dsl/harness`             | Runs a script against a real headless Desmos calculator                                             |
| `axis-dsl` (extension)          | The VSCode extension: an LSP client for the server, and the preview                                 |
| `@axis-dsl/site` (`docs/site/`) | The docs site: Astro Starlight, its reference generated from the manifest and the catalogues        |

The layering is syntax ← compiler ← language-service ← language-server, each
using only what is to its left - so something the compiler and the editor both
need belongs in syntax or the compiler, never in the language service.
Everything is released together at one version. A change leaves the versions
alone and adds a line under **Unreleased** in `CHANGELOG.md`; the release itself
is `node scripts/release.mjs 2.2.0`, a commit and a `v2.2.0` tag, and
`.github/workflows/release.yml` publishes from the tag.

### Where each stage lives

Forwards, a script goes `lexer.ts` → `parser.ts` (both in syntax) → the
compiler's `program.ts`, which reads the import graph → `symbols.ts` →
`check.ts` → `macros.ts`, which expands on trees, and `styles.ts`, which
resolves `use:` away → `lower.ts`, which builds the graph state and the source
map, with `latex/emit.ts` writing each expression.

Backwards, `latex/parse.ts` reads Desmos' latex into a tree, `decompile.ts`
builds statements out of a graph state, and `readback.ts` and `writeback.ts`
turn a change made on a calculator into an edit to the script. All of them
print through syntax's `print.ts`, so generated source is laid out exactly as
the formatter would lay it out.

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
```

Tests run against each package's built `dist/`, so **build before testing** —
`pnpm test` does it for you.

## The harness — use it

**The compiler can only tell you what it emitted, not whether Desmos accepts
it.** That gap is where the bugs live, and it is invisible to any test that
stops at the compiler. Real ones found exactly there: sliders that compiled
perfectly and were then dropped on the floor by `setState`, `3cos(t)` compiling
to three variables multiplied together, `2^10` coming out 0, a ticker that ran
and changed nothing, and an inequality Desmos will not shade. Every one of them
looked fine in the compiler's own output.

So when you touch anything that ends up in a graph, **ask a real calculator**:

```sh
node packages/harness/dist/cli.js examples/scripts/06-sliders-and-animation.axis
```

```
06-sliders-and-animation.axis — 25 expressions, 0 diagnostics, 0 errors

  0  text       Sliders
  1  ok         a=1 = 1
  2  ok         b=0 = 0
  3  ok         c=1 = 1
  …
```

It exits `1` if the compiler reports an error or any expression is in error, so
it also works as a check.

```sh
axis-inspect <file.axis>          # a file, imports resolved from disk
axis-inspect -e 'y = x^2'         # source inline
axis-inspect - < graph.axis       # source on stdin
  --json                          # the whole inspection, machine-readable
  --errors-only                   # only what Desmos rejected
  --eval 'f(20)'                  # evaluate an Axis expression against the graph (repeatable)
  --screenshot out.png            # write a PNG of the graphpaper
  --offline                       # fail rather than fetch from desmos.com
```

`--json` is the one to reach for when you want to inspect structure: it carries
the full graph state, every expression's `expressionAnalysis`, the compiler's
diagnostics, and any console errors the page raised.

In a test, `packages/harness/test/support.mts` gives you a shared calculator:

```ts
import { skip, useCalculator } from './support.mts';

describe('what I changed', { skip }, () => {
    const calculator = useCalculator();

    test('is a graph Desmos accepts', async () => {
        await calculator().load('f(x) = 2x + 1\ny = f(x)');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('f(20)')).numericValue, 41);
    });
});
```

`getErrors()`, `inspectExpressions()`, `getState()`, `getSettings()`,
`evaluate()`, `click({x, y})` and `screenshot()` are the useful ones — see
[`packages/harness/README.md`](./packages/harness/README.md) for the rest.

## Where a test goes

Anything that needs no calculator goes in the package it is about, where it is
fast and runs without a browser: how source lexes, parses and prints in
`packages/syntax/test`; what the checker reports, how a macro or a style
resolves, what a statement lowers to, what latex comes out and what reads back
in `packages/compiler/test`; completions, hover and the other editor services
in `packages/language-service/test`; the LSP wiring in
`packages/language-server/test`. Anything about what Desmos _does_ with the
result goes in `packages/harness/test`:

| File                   | What it pins                                                                   |
| ---------------------- | ------------------------------------------------------------------------------ |
| `metadata.test.mts`    | every `@` property, placement by placement, read back off the applied graph    |
| `config.test.mts`      | every `config { … }` property, read back off `calculator.settings`             |
| `language.test.mts`    | every function and constant in the manifest, plus the operators                |
| `expressions.test.mts` | emitted latex, evaluated by Desmos and compared with the tree's own value      |
| `styles.test.mts`      | how `use:` combines styles, checked on the graph they style                    |
| `diagnostics.test.mts` | a script with a mistake in it: what is reported, and that the rest still draws |
| `graph.test.mts`       | folders, tables, notes, imports, images, and every example script              |
| `ticker.test.mts`      | the `ticker` statement, and that a playing one actually ticks                  |
| `macros.test.mts`      | what a `macro` expands to, evaluated rather than just compiled                 |
| `decompile.test.mts`   | decompiling the graph state a real calculator hands back                       |
| `writeback.test.mts`   | changes made to a live graph, written back into the script                     |
| `docs.test.mts`        | every manifest example and every `axis` block in the docs, drawn cleanly       |
| `harness.test.mts`     | the harness itself                                                             |

**Adding a name to the manifest means adding a test.** The first three suites
are driven from `@axis-dsl/syntax`'s manifest and have guard tests that fail
when a function, a constant or a property appears there with nothing
exercising it. The metadata guard walks each placement's `propertiesFor`, not
the list of names, so a property newly allowed on a column or an image needs a
case there even when it is already tested on an expression - the same property
reaches a different part of the graph in each place, and any one of them can
lose it. That is deliberate, and the fix is a test, not an exemption.

**And an example.** Every function, operator and property in the manifest has
an `example` - the type will not compile without one - and may have
`documentation` beyond its `detail`. Hover shows both, and the docs site's
reference is generated from them and nothing else. An example is a whole
script, read as though it sat in `examples/scripts/`; the compiler's
`manifest.test.mts` compiles each one clean and checks it uses the name it
documents, and the harness' `docs.test.mts` draws it on a calculator.

**A code block in the docs is a claim about the language.** Every ` ```axis `
block written by hand - on the site, in the spec, in `KEYWORD_INFO` - is
gathered by `docs/site/scripts/blocks.mts`, compiled clean by the compiler's
`docs.test.mts` and drawn by the harness'. A block that shows a mistake says
so, ` ```axis error="unknown-function" `, and must raise exactly that. A
fragment that is not a whole script gets a plain fence.

**A new diagnostic code means a catalogue entry.** `SYNTAX_DIAGNOSTICS` in
syntax and `COMPILER_DIAGNOSTICS`/`DECOMPILER_DIAGNOSTICS` in the compiler
declare every code, and every `report` is typed to take only those - so a new
code will not compile until it has a summary and an example that raises it and
nothing else. The same summary goes in the spec's §8 or §11 table, word for
word: the compiler's `diagnostics.test.mts` compares them.

**Changing how something compiles means changing how it decompiles.** The
decompiler is the compiler's inverse and is tested as one: `decompile.test.mts`
in the compiler package holds `compile ∘ decompile ∘ compile ≡ compile` over
every example, so a new statement, property or latex rule needs the reading of
it as well as the writing — and the round trip will say so.

**Changing how something compiles means changing the source map.** The compiler
hands back a `sourceMap` from every item's id to the `span` of the statement
that produced it, and `writeBackGraph` rewrites exactly those characters - so a
new statement form has to record where it came from, or a change made to it in
a graph lands in the wrong place. Spans are offsets rather than lines, so two
statements sharing a line are rewritten independently.
`packages/compiler/test/writeback.test.mts` is what notices when one is missing
or wrong.

**Changing how something compiles means checking the examples.** They are the
widest use of the language there is, and `graph.test.mts` runs every one of
them through a calculator. `node packages/harness/dist/cli.js <file>` on the
one you touched is the quick version.

## Things that have caught people out

- **`setState` and `setExpression` take different shapes.** Everything here
  applies expressions with `setState`, because folder membership only travels
  that way — so the compiler emits the _graph state_ form. `slider`, not
  `sliderBounds`; `clickableInfo`, not `onClick`. A property in the wrong form
  is not an error, it is silence.
- **An unknown function name is not an error either - to Desmos.**
  `n_{otAFunction}\left(x\right)` is a product of variables it accepts happily
  and never evaluates. The checker reports `unknown-function` so an author
  hears about it, but in a harness test assert on `analysis.evaluation` or
  `isGraphable`, not just on `getErrors()` being empty.
- **Nor is an equation that is never true.** `\pi=3` is simply false, so
  Desmos draws nothing and says nothing - which is why assigning to `pi`,
  `tau`, `e` or `infinity` is `assign-to-builtin` rather than left to Desmos.
- **`dt` is `\operatorname{dt}` and nothing else.** Written any other way it is
  d times t: the ticker runs, changes nothing, and nothing anywhere reports an
  error. `latex/names.ts` spells it; keep it that way.
- **Latex is read by juxtaposition, and reads more than you meant.**
  `2\frac{1}{2}` is the mixed number 2½, `2` beside `3` is 23, and a
  `\left[` after anything at all indexes it - so `juxtapose` in
  `latex/emit.ts` writes a `\cdot` after a digit before a fraction or a
  number, and before a list. `1e3` is 1·e·3, since Desmos has no scientific
  notation, so a number is written out in full.
- **An image is `draggable`, not `dragMode`.** Desmos ignores `dragMode` on an
  image and keeps a boolean instead. The compiler lowers any mode but `NONE` to
  `draggable: true`, and the decompiler reads it back as `dragMode: XY`.
- **The newer point styles are stashed.** A calculator hands a v1.12 point
  style back under `__stashed_V12PointStyle` rather than `pointStyle`, and
  without `doNotMigrateMovablePointStyle: true` on the state it substitutes its
  own style for any point it decides is movable. The compiler sets the flag;
  the decompiler reads the stash.
- **Desmos' defaults are not the ones you would guess.** A list of points draws
  only the points unless it says `lines`; a parametric curve given no `domain`
  runs `t` over [0, 1], not a whole period; and a stepped slider snaps its
  value to the step's grid, counted from its `min`, so `a = 1` with a step of
  0.3 from -3 starts at 0.9.
- **`evaluate` takes Axis, not latex.** `evaluate('amp')` asks about the
  variable the script calls `amp`; the raw latex `amp` is three variables
  multiplied. `evaluateLatex` takes it verbatim.
- **A config option can gate another.** `logScales: false` forces
  `xAxisScale` back to linear, so config properties are tested one at a time
  rather than in one big block.
- **`actions: auto` cannot see a ticker.** Desmos decides `auto` from the
  expression list, and the ticker is not in it - so a graph whose only action is
  its ticker gets actions switched off and simply never ticks. The compiler sets
  `actions: true` for a script with a ticker for that reason.
- **A macro is expanded and then forgotten.** It is substituted into the tree
  before lowering, so nothing about one survives into the graph and there is
  nothing for the decompiler to read back - which is why the round trip holds
  over a script full of them without the decompiler knowing the word. A style
  is the same. The other side of it: the checker reads the tree _before_
  expansion, so a diagnostic points at text the author wrote, and a statement
  a macro expanded into is marked unwritable in the source map, since writing
  the graph back over it would replace the call with its expansion.
- **An image from a file is read before the compiler runs.** `image "./a.png"`
  is resolved the way an import is - a host walks the graph with `loadImages`,
  the compiler asks a synchronous `resolveImage` and inlines a `data:` URI - so
  a new host has to do both walks, and a test that compiles a script drawing a
  picture has to hand it a `resolveImage`. A URL or a `data:` URI is passed
  through untouched and needs neither.
- **Desmos normalises what you give it.** It leaves a property off the state
  when it matches its own default - a slider bound, a colour, a line width -
  and writes a switched-off clickable by omitting `enabled` rather than storing
  `false`. Assert against what it actually returns, which is what the harness
  is for.
- **A property missing from a state is not a property that was removed.** The
  same normalisation, from the other side: a slider given both its bounds comes
  back carrying only the `min`, because the `max` matched Desmos' own default.
  Anything writing a graph back to source has to merge the _change_ onto what
  the script said rather than take the calculator's answer whole, or dragging
  that slider deletes the top of `0..10` from somebody's file. `writeBackGraph`
  does; the harness test for it is the only thing that could have caught it.
- **A graph does not remember where its pictures came from.** `image
"./beach.png"` is resolved and inlined as a `data:` URI before the compiler
  runs, so nothing in the graph knows the path. Anything writing a graph back to
  source has to take the picture's name from the statement being replaced -
  `writeBackGraph` does, and without it dragging a picture swaps its filename
  for the whole picture in base64.
- **A graph can move without anybody touching it.** A playing slider re-numbers
  itself several times a second and a running ticker changes whatever it drives.
  Anything that reacts to `change` has to tell that apart from an edit, or it
  fires forever - the write-back refuses both, by name.

## Style

Match the surrounding code. Comments explain _why_, in prose, and the existing
files are the reference for how much of it to write — see
`packages/compiler/src/compile.ts` or `packages/harness/src/page.ts`.
