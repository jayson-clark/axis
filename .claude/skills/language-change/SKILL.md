---
name: language-change
description: Adding or changing something in the Axis language - a function, constant, operator, property, statement, diagnostic code or latex rule - and everything that has to change with it (manifest, tests, examples, catalogue, spec, decompiler, source map, docs, changelog). Use for any change to what Axis accepts, reports or compiles to.
---

# Changing the language

[`docs/spec.md`](../../../docs/spec.md) is the language. Change it with the
code: where the two disagree, one of them is a bug.

## Where each stage lives

Forwards, a file goes `lexer.ts` → `parser.ts` (both in syntax) → the
compiler's `program.ts`, which reads the import graph → `symbols.ts` →
`check.ts` → `macros.ts`, which expands on trees, and `styles.ts`, which
resolves `use:` away → `lower.ts`, which builds the graph state and the source
map, with `latex/emit.ts` writing each expression.

Backwards, `latex/parse.ts` reads Desmos' latex into a tree, `decompile.ts`
builds statements out of a graph state, and `readback.ts` and `writeback.ts`
turn a change made on a calculator into an edit to the file. All of them print
through syntax's `print.ts`.

The layering is syntax ← compiler ← language-service ← language-server: what
the compiler and the editor both need belongs in syntax or the compiler, never
in the language service.

## What has to change with it

Work down the list. The tests named are the ones that fail when a step is
missed, and the fix is always the missing piece, never an exemption.

1. **The spec.** The statement, property or rule, in `docs/spec.md`.
2. **The manifest**, in `packages/syntax/src/manifest.ts`, for a function,
   operator, constant or property. Every entry has an `example` - the type will
   not compile without one - and may have `documentation` beyond its `detail`.
   Hover shows both and the docs site's reference is generated from nothing
   else. An example is a whole file, read as though it sat in
   `examples/`; the compiler's `manifest.test.mts` compiles it clean and
   checks it uses the name it documents, and the harness' `docs.test.mts` draws
   it.
3. **A harness test.** `metadata`, `config` and `language` in
   `packages/harness/test` have guard tests that fail when a manifest name has
   nothing exercising it. The metadata guard walks each placement's
   `propertiesFor`, so a property newly allowed on a column or an image needs a
   case there even when it is already tested on an expression. See the
   `desmos-harness` guide.
4. **A diagnostic code's catalogue entry.** `SYNTAX_DIAGNOSTICS` in syntax and
   `COMPILER_DIAGNOSTICS`/`DECOMPILER_DIAGNOSTICS` in the compiler declare every
   code, and every `report` is typed to take only those - so a new code will not
   compile until it has a summary and an example that raises it and nothing
   else. The same summary goes in the spec's §8 or §11 table, word for word:
   the compiler's `diagnostics.test.mts` compares them.
5. **The decompiler.** It is the compiler's inverse and is tested as one:
   `decompile.test.mts` in the compiler holds
   `compile ∘ decompile ∘ compile ≡ compile` over every example, so a new
   statement, property or latex rule needs the reading of it as well as the
   writing. See the `write-back` guide.
6. **The source map.** A new statement form has to record the `span` it came
   from, or a change made to it in a graph lands in the wrong place.
   `packages/compiler/test/writeback.test.mts` notices.
7. **The examples.** They are the widest use of the language there is, and
   `graph.test.mts` runs every one through a calculator. Run the ones you
   touched: `node packages/harness/dist/cli.js examples/<file>`. A new
   feature usually earns a line in the example that covers its topic.
8. **The docs.** The site's guide pages under `docs/site/src/content/docs/guide`
   are written by hand; the reference is generated from the manifest and the
   catalogues. Every ` ```axis ` block written by hand - on the site, in the
   spec, in `KEYWORD_INFO` - is compiled clean and drawn by `docs.test.mts`. One
   that shows a mistake says so, ` ```axis error="unknown-function" `, and must
   raise exactly that.
9. **The changelog.** A line under **Unreleased** in `CHANGELOG.md`, under
   Added, Changed, Deprecated, Removed or Fixed. A file that compiled before
   and now errors or draws differently is a breaking change - see the `release`
   guide before making one.

## Things that have caught people out

- **`dt` is `\operatorname{dt}` and nothing else.** Written any other way it is
  d times t: the ticker runs, changes nothing, and nothing anywhere reports an
  error. `latex/names.ts` spells it; keep it that way.
- **Latex is read by juxtaposition, and reads more than you meant.**
  `2\frac{1}{2}` is the mixed number 2½, `2` beside `3` is 23, and a `\left[`
  after anything at all indexes it - so `juxtapose` in `latex/emit.ts` writes a
  `\cdot` after a digit before a fraction or a number, and before a list. `1e3`
  is 1·e·3, since Desmos has no scientific notation, so a number is written out
  in full.
- **An unknown function or a never-true equation is not an error to Desmos.**
  That is why the checker has `unknown-function` and `assign-to-builtin`: a
  mistake Desmos stays quiet about has to be reported by Axis or nobody hears
  of it.
- **A macro is expanded and then forgotten.** It is substituted into the tree
  before lowering, so nothing about one survives into the graph and there is
  nothing for the decompiler to read back. A style is the same. The checker
  reads the tree _before_ expansion, so a diagnostic points at text the author
  wrote, and a statement a macro expanded into is marked unwritable in the
  source map.
- **An image from a file is read before the compiler runs.** `image "./a.png"`
  is resolved the way an import is - a host walks the graph with `loadImages`,
  the compiler asks a synchronous `resolveImage` and inlines a `data:` URI - so
  a new host has to do both walks, and a test that compiles a file drawing a
  picture has to hand it a `resolveImage`. A URL or a `data:` URI is passed
  through untouched and needs neither.
- **The graph state form, not the API's.** The compiler emits what `setState`
  takes, because folder membership only travels that way. A property in the
  API's shape is silently dropped - the `desmos-harness` guide has the rest of
  what Desmos does quietly.
