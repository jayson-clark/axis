# @axis-dsl/compiler

Compiles [Axis](https://github.com/jayson-clark/axis) source into a Desmos
graph: one graph state for `setState`, and the calculator options.

```sh
npm install @axis-dsl/compiler
```

## Usage

```ts
import { compileAxis } from '@axis-dsl/compiler';

const { state, options, diagnostics } = compileAxis(`
config { showGrid: true }

"Basic functions"

f(x) = x ^ 2 - 4x + 3 @ color: RED
g(x) = sin(x) + cos(2x) @ color: #2d70b3, lineWidth: 2
`);

calculator.setState(state);
// updateSettings has to follow setState, which resets the calculator's settings.
calculator.updateSettings(options);
```

`state` is the whole graph state, the payload of one `setState`: the expression
list, the ticker beside it, the viewport and the rest of the `graph` settings,
and the flags Desmos reads off the top of a state. `options` is the calculator
options - the Axis defaults under whatever the script's `config` said. Both are
typed by [`@axis-dsl/desmos`](https://www.npmjs.com/package/@axis-dsl/desmos),
and applying them is the two calls above and nothing else: the state is
complete, with a viewport of ±10 filled in for a script that names none.

The viewport is why there are two halves. `xmin` and its siblings read like any
other config key, but Desmos keeps them in a graph's **state**, not in its
calculator's options, so `updateSettings({ xmin: 0 })` is not an error, it is
silence. The compiler puts every key where Desmos will read it.

Desmos has two shapes for an expression, and they are not interchangeable.
`setExpression` takes the API's; `setState` takes the serialized graph state's,
which is the only one that carries a folder - and folders are the reason Axis
compiles to the state form throughout. `folderId`, `collapsed`, `clickableInfo`
and `slider` all mean nothing to `setExpressions`, and mean nothing _quietly_:
a property in the wrong shape is dropped rather than reported.

## Diagnostics

`compileAxis` never throws on a script. Everything wrong with one - from the
parser, the checker or the compiler - comes back in `diagnostics`, beside the
graph the rest of the script still makes, so a preview keeps drawing while a
line is half written:

```ts
const { diagnostics } = compileAxis('y = sine(x) @ color: red');
// [
//   { code: 'unknown-function', severity: 'error', span: { start: 4, end: 8 }, message: … },
//   { code: 'invalid-color', severity: 'error', span: { start: 21, end: 24 }, message: … },
// ]
```

Each has a stable `code` to match on, and a `span` of UTF-16 offsets into the
file it is about - the script, unless the diagnostic carries a `path`, in which
case it is the imported file of that name. `docs/spec.md` §8 lists the codes.

Every code is declared once, in a catalogue - `SYNTAX_DIAGNOSTICS` in
`@axis-dsl/syntax` for the lexer and parser, `COMPILER_DIAGNOSTICS` and
`DECOMPILER_DIAGNOSTICS` here - with the spec's summary of it and a script
that raises it. Everything that reports one is typed to take only a
catalogued code, so `AxisDiagnosticCode` is the complete list, and the tests
hold the spec's tables and the catalogues to each other.

## The passes

`compileAxis` is a pipeline over a syntax tree, and each stage is exported on
its own for a tool that wants one of them - an editor checking a script
without lowering it, say, which is what `@axis-dsl/language-service` does:

```ts
import { checkProgram, collectSymbols, loadProgram } from '@axis-dsl/compiler';

const program = loadProgram(source, { path, resolveImport });
const { symbols, diagnostics: defined } = collectSymbols(program);
const { diagnostics: checked } = checkProgram(program, symbols);

const diagnostics = [...program.diagnostics, ...defined, ...checked];
```

`loadProgram` parses the script and everything it imports, in the order the
imports land. `collectSymbols` gathers every macro, style, function and
variable the whole program defines - macros and styles are global across a
compilation, which is why this is a pass over every file before any is checked.
`checkProgram` is everything the parser cannot know: an unknown function, a
property in the wrong place or of the wrong type, a macro used with the wrong
number of arguments.

After that, lowering walks each statement: `expandMacros` substitutes macro
uses as trees - so `double(1 + 2) ^ 2` never needs brackets to mean what it
says - `resolveProperties` applies a clause's `use:` styles under its own
properties, and `emitLatex` writes each expression as the latex Desmos reads.

## Imports

Compilation is synchronous and touches no filesystem, so a script with
`import "./waves"` in it is handed a resolver rather than a path to go reading.
`loadImports` walks the import graph first over whatever reading a file means
where you are - `node:fs`, a VSCode workspace, a `Map` in a test:

```ts
import { compileAxis, createImportResolver, loadImports } from '@axis-dsl/compiler';
import { withAxisExtension } from '@axis-dsl/syntax';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const host = {
  resolve: (specifier, from) => resolve(dirname(from), withAxisExtension(specifier)),
  read: path => readFile(path, 'utf8'),
};

const files = await loadImports({ path, source }, host);
const { state, options, dependencies } = compileAxis(source, {
  path,
  resolveImport: createImportResolver(files, host.resolve),
});
```

The host owns `resolve` because only it knows what its paths mean - where a
leading `/` points, whether the `.axis` may be left off, what names a file.
Whatever it returns is compared for equality to detect cycles and to include a
file imported twice only once, and is handed back in `dependencies.imports`, so
two specifiers naming the same file must resolve to the same string.

`dependencies.imports` names every file that was read, transitively. That is the
set to watch if the graph is live: a script is stale when anything it imports
changes, not only when it does.

A file `loadImports` cannot read is left out rather than failing the walk, and
an import that does not resolve - for want of the file or of a resolver - is an
`unresolved-import` diagnostic against the statement, rather than a graph
quietly smaller than was asked for.

## Images

`image "./beach.png"` names a file the way an import does, and is reached the
same way - through a resolver, because the compiler still touches no filesystem.
What it resolves to is a `data:` URI, which is inlined into the graph: Desmos
stores an image as its URL, and a path on the machine the script was written on
is not one anybody else's browser can fetch, so a graph has to carry its
pictures with it.

```ts
import { compileAxis, createImageResolver, loadImages } from '@axis-dsl/compiler';

const pictures = {
  resolve: (url, from) => resolve(dirname(from), url),
  read: async path => new Uint8Array(await readFile(path)),
};

// `files` is what loadImports handed back: an imported script draws its own
// images, so one walk of the import graph serves both.
const images = await loadImages({ path, source }, files, pictures);
const { state, dependencies } = compileAxis(source, {
  path,
  resolveImage: createImageResolver(images, pictures.resolve),
});
```

The media type comes from the extension, and a file whose extension is not an
image's is an `invalid-image` diagnostic rather than a picture a browser has to
guess at. `dependencies.images` names every file that was inlined - the other
half of the set to watch if the graph is live.

An `image` that names something Desmos can already load - `https:`, `data:` -
reaches the graph exactly as it was written, and needs no resolver at all.

## Latex

Desmos stores every expression as latex, and the compiler writes it from the
expression tree rather than by rewriting source text. That is what makes
precedence something already settled by the time latex is written: `1/2x` is
`\frac{1}{2}x`, `a/b^2` is `\frac{a}{b^{2}}`, and `3cos(t)` is a coefficient on
a function rather than three variables multiplied.

```ts
import { emitLatex, identifierLatex, parseLatex } from '@axis-dsl/compiler';
import { parseExpression, printExpression } from '@axis-dsl/syntax';

emitLatex(parseExpression('1/2x + 3cos(t)').expression);
// \frac{1}{2}x+3\cos\left(t\right)

printExpression(parseLatex('\\frac{1}{2}x+3\\cos\\left(t\\right)'));
// 1 / 2 x + 3cos(t)

identifierLatex('amp'); // a_{mp}
```

`parseLatex` is the way back, for the decompiler, and reads latex the way
Desmos does: where the two readings of a piece of latex could differ, Desmos'
is the one followed, since that is the graph somebody is looking at. Latex it
has no node for - `\sum`, `\int` - is a `LatexParseError` rather than a guess.

## Decompiling

The other direction: a graph back into the script that builds it.

```ts
import { decompileAxis } from '@axis-dsl/compiler';

const { source, diagnostics } = decompileAxis({
  state: calculator.getState(),
  options: calculator.settings,
});
```

The input is what `compileAxis` hands a host, or what a calculator hands back;
`options` may be left off, since a graph saved at desmos.com is a state and
nothing else. Expressions become statements, their Desmos properties become the
`@` metadata that sets them - a palette hex as its name, a slider as a range, a
stashed point style as the `pointStyle` it is - folders become
`folder "…" { … }` blocks, and the settings become the `config { … }` block at
the top. The statements are built as tree nodes and printed with the
formatter's printer, so what comes back is source somebody could have written,
and, more to the point, source that compiles to the graph it was read from:

```
compileAxis(decompileAxis(compileAxis(source)).source) ≡ compileAxis(source)
```

That holds for every example script, and for the graph state a real calculator
hands back, which is not the same object: Desmos leaves a slider bound off when
it matches its own default, writes a switched-off clickable by omitting
`enabled` rather than storing `false`, and normalises the latex. What lowering
filled in - a viewport edge of ±10, a setting equal to Axis' default - is left
out again, so a decompiled script is no longer than it has to be.

What a graph cannot tell you:

- **Imports are gone.** They were flattened into folders when the script was
  compiled, so they come back as the folders the reader sees. **Macros and
  styles are gone** too: the graph holds what they expanded to, and that is
  what comes back.
- **Comments are gone**, along with blank lines and anything else the source
  said that the graph does not carry.
- **A picture inlined from a file** comes back as its `data:` URI, since the
  graph never knew the path.

**What Axis cannot write is reported, never thrown.** Latex `parseLatex` has no
reading for leaves its expression out, and a comment stands where it would have
been:

```
// unsupported: y=\sum_{n=0}^{3}x^{n}
a = 2 @ slider: 0..5 step 0.5
```

Each is a warning in `diagnostics` - `unsupported-latex`, `unsupported-item` or
`unsupported-value` - whose span is that comment in `source`. The check that
matters beyond the round trip is that a real calculator reads the two graphs
the same way, which is what `packages/harness/test/decompile.test.mts` asks it.

`decompileExpression`, `decompileSettings` and `decompileTicker` hand back one
item's statement node on its own - a folder as its header, with an empty body -
which is the unit write-back works in.

## Writing a changed graph back

A Desmos graph is not only something a script produces; it is something a person
edits. Dragging a point moves it, dragging a slider re-numbers it, the colour
picker recolours it — and every one of those is a change the script it came from
now disagrees with.

Decompiling the whole graph and writing that out would close the gap and would
throw away everything a script has that a graph does not: the comments, the
blank lines, the macros, the styles, the folders an import stands for. So
`writeBackGraph` works a statement at a time, and returns the characters to
replace:

```ts
import { applySourceEdits, compileAxis, writeBackGraph } from '@axis-dsl/compiler';

const compiled = compileAxis(source, { path: 'main.axis' });

// Applied to a calculator, then read straight back: Desmos normalises what it
// is given, so the baseline has to be its answer rather than what it was sent.
calculator.setState(compiled.state);
calculator.updateSettings(compiled.options);
const read = () => ({ state: calculator.getState(), options: { ...calculator.settings } });
const before = read();

// …the user drags something…

const { edits, skipped } = writeBackGraph(source, { before, after: read() }, compiled);
const updated = applySourceEdits(source, edits);
```

What makes it possible is the **source map**. `compileAxis` returns one:
every expression id against the file and the lines the statement covers.

```ts
compiled.sourceMap.get('expr_2');
// { path: 'main.axis', line: 6, endLine: 9, span: { start: 81, end: 143 }, writable: true }
```

Ids are the other half. The compiler stamps each expression with one, `setState`
keeps it and `getState` hands it back, so a point dragged halfway across the
graph is still recognisably the statement it came from.

**What cannot be written is reported rather than attempted.** Every refusal
comes back in `skipped` with a reason:

- a statement a **macro** expanded into — the text there is not what the
  compiler read, so rewriting it would replace the macro with its expansion
  (deleting one is fine, and is done)
- a statement in a file the script **imports** — only the script handed over is
  edited, and the reason names the file
- an **animating slider** or a **running ticker**, which is the graph working
  rather than somebody changing it; left in, a file would rewrite itself for as
  long as the tab was open. A ticker that was running when the graph loaded
  holds every change back, since what it drove cannot be told from an edit
- an expression **moved between folders**, and anything added to the folder an
  import stands for
- a **picture added in Desmos**, which arrives carrying its own bytes — a script
  has no `image` statement meaning "these bytes", only ones that name a file or
  a URL, so writing it out would put the whole picture into the source
- a key Desmos changed that **no Axis property says** — the rest of the change
  is still written, and the key is named

Statements sharing a line through `;` are each written on their own: an edit
replaces exactly the span of the statement that changed.

What it is careful about, each of which would cost a script something real if
it were got wrong:

- **A property Desmos did not hand back is not a property that was removed.** A
  slider written `slider: 0..10` comes back carrying only the min, because 10
  is Desmos' own default. So a statement is re-read from the source and only the
  properties that differ between the two readings are rewritten on it — the
  rest, and every part of a changed expression that did not change, stay the
  nodes the author wrote. Otherwise dragging that slider would delete its max.
- **A style is not expanded.** A property that came from a `use:` and changed
  in the graph is written on the statement as an override; the `use:` stays.
- **A picture's URL is not the picture's URL.** `image "./beach.png"` is read
  off a disk and inlined as a `data:` URI before the graph exists, so the graph
  carries the bytes and the path is gone. Dragging a picture is a real edit and
  is written; the name it was written with comes back from the source, never
  from the graph, or the filename would be replaced by a megabyte of base64.
- **The viewport is only written for a script that framed itself.** Panning and
  zooming are how anybody reads a graph. A script with no `xmin` in its config
  does not grow four lines about one the first time somebody scrolls.

The statement that does get rewritten is printed by the formatter's printer
over exactly its own span, so it keeps its place, its trailing comment, its
`@{ … }` block and the comments inside it, and the order its properties were
written in. Settings go into the script's own `config` block, or one opened at
the top for them; an expression made in the calculator goes at the end of the
folder it was made in, or of the script; one deleted there is deleted here.

## API

| Export                                                           |                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `compileAxis(source, options?)`                                  | The compiler. Returns a `CompilationResult`                                                     |
| `loadImports(entry, host)`                                       | Reads every file reachable by `import`, transitively; returns a `Map` keyed by path             |
| `createImportResolver(files, resolve)`                           | Turns that `Map` into the synchronous `resolveImport` the compiler wants                        |
| `findImports(source)`                                            | Just the specifiers one file imports, in order                                                  |
| `loadImages(entry, files, host)`                                 | Reads every image file the script and its imports draw; returns a `Map` of data URIs            |
| `createImageResolver(images, resolve)`                           | Turns that `Map` into the synchronous `resolveImage` the compiler wants                         |
| `findImageFiles(source)`                                         | Just the image paths one file draws, in order                                                   |
| `loadProgram(source, options?)`                                  | The first pass: the script and everything it imports, parsed                                    |
| `collectSymbols(program)`                                        | The second: every macro, style, function and variable the program defines                       |
| `checkProgram(program, symbols)`                                 | The third: every semantic diagnostic, and which calls are really products                       |
| `expandMacros(expression, macros)`                               | One expression with its macros substituted, as trees                                            |
| `resolveProperties(entries, styles)`                             | One metadata clause with its styles applied                                                     |
| `definitionOf(expression)`                                       | What a statement defines - a function, a variable - or nothing                                  |
| `emitLatex(expression)`                                          | One expression tree as Desmos latex                                                             |
| `parseLatex(latex)`                                              | Desmos latex back into an expression tree; throws `LatexParseError` on what it cannot read      |
| `identifierLatex(name)`                                          | A name as Desmos spells it: `amp` is `a_{mp}`, `theta2` is `\theta_{2}`                         |
| `decompileAxis(input, options?)`                                 | The decompiler. A graph's `{ state, options? }` back into `{ source, statements, diagnostics }` |
| `decompileExpression(item, options?)`                            | One list item as the statement that builds it - the decompiler's unit of work                   |
| `decompileSettings(input)`                                       | Just the `config { … }` block a graph's settings decompile to, or null                          |
| `decompileTicker(ticker)`                                        | The graph's ticker, as the `ticker` statement that runs it                                      |
| `writeBackGraph(source, { before, after }, compiled, options?)`  | What changed on a live graph, as edits to the statements that produced it                       |
| `diffGraphs(before, after)`                                      | Just the changes between two readings of the same graph, by expression id                       |
| `applySourceEdits(source, edits)`                                | Applies one file's edits to its text                                                            |
| `propertyWrites` / `applyPropertyWrites`                         | Which properties two decompiled readings of one item disagree on, merged onto a clause          |
| `mergeExpression(source, before, after)`                         | A changed expression with every unchanged part kept as the author wrote it                      |
| `COMPILER_DIAGNOSTICS`, `DECOMPILER_DIAGNOSTICS`                 | Every code the checker, compiler and decompiler report, with a summary and an example           |
| `CompileOptions`                                                 | `{ path?, resolveImport?, resolveImage? }`                                                      |
| `CompilationResult`                                              | `{ state, options, diagnostics, sourceMap, configOrigin?, dependencies }`                       |
| `StatementOrigin`                                                | `{ path, line, endLine, span, writable, reason? }` - where one item was written                 |
| `Program` / `SourceFile` / `ImportResolution`                    | What `loadProgram` hands back: every file, parsed, and what each import meant                   |
| `Symbols` / `Definition` / `MacroDefinition` / `StyleDefinition` | What `collectSymbols` and `definitionOf` find                                                   |
| `CheckResult` / `Expansion`                                      | What `checkProgram` and `expandMacros` return                                                   |
| `DecompileInput` / `DecompileResult`                             | `{ state, options? }` and `{ source, statements, diagnostics }`                                 |
| `DecompiledStatement` / `DecompileExpressionOptions`             | `{ statement, diagnostics }` and `{ definedNames? }`                                            |
| `GraphSnapshot` / `GraphChange` / `ChangeKind` / `SourceEdit`    | A graph's `{ state, options? }`, one change to it, and one replacement of a span                |
| `WriteBackOptions` / `WriteBackResult` / `SkippedChange`         | `{ include?, indent?, path? }`, `{ edits, skipped }`, and one refusal with its reason           |
| `PropertyWrite`                                                  | One property to set or remove on a clause                                                       |
| `ImportHost` / `ResolveImport` / `ResolvedImport`                | The import resolver types                                                                       |
| `ImageHost` / `ResolveImage` / `ResolvedImage`                   | The image resolver types                                                                        |

MIT
