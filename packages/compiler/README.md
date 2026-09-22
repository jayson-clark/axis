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

The passes are exported one by one too - `loadProgram`, `collectSymbols`,
`checkProgram` - for a tool that wants to check a script without lowering it.

## Imports

Compilation is synchronous and touches no filesystem, so a script with
`import "./waves"` in it is handed a resolver rather than a path to go reading.
`loadImports` walks the import graph first over whatever reading a file means
where you are - `node:fs`, a VSCode workspace, a `Map` in a test:

```ts
import { compileAxis, createImportResolver, loadImports } from '@axis-dsl/compiler';
import { withAxisExtension } from '@axis-dsl/language';
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

## Decompiling

> The decompiler and the write-back below still speak Axis 1, and read the
> graphs its compiler made. They move onto the v2 language in #23 and #24.

The other direction: a graph back into the script that builds it.

```ts
import { decompileAxis } from '@axis-dsl/compiler';

const state = calculator.getState();

const source = decompileAxis({
  expressions: state.expressions.list,
  settings: calculator.settings,
  graph: state.graph,
});
```

Expressions become statements, their Desmos properties become the `# key: value`
metadata that sets them, folders become `folder "…" { … }` blocks and the
settings become the `config { … }` block at the top. What comes back is source
somebody could have written — indented, spaced and quoted the way the formatter
would write it — and, more to the point, source that compiles to the graph it
was read from:

```
compileAxis(decompileAxis(compileAxis(source))) ≡ compileAxis(source)
```

That holds for every example script, and for the graph state a real calculator
hands back, which is not the same object: Desmos leaves a slider bound off when
it matches its own default, writes a switched-off clickable by omitting
`enabled` rather than storing `false`, and normalises the latex.

Three things a graph cannot tell you, and one it cannot hold:

- **Imports are gone.** They were flattened into folders when the script was
  compiled, so they come back as the folders the reader sees. **Macros are gone**
  for the same reason and more finally: they were substituted away before the
  first statement was read, so what comes back is what they expanded to.
- **Comments are gone**, along with blank lines and anything else the source
  said that the graph does not carry.
- **A note is one line in double quotes**, and Axis has no escape for either, so
  a newline in the text becomes a space and a `"` becomes a `'`.
- **LaTeX Axis has no spelling for** — an `\operatorname` it does not know, a
  command it has never heard of — is passed through as written, which leaves one
  recognisable thing to fix by hand rather than a mangled expression.

What survives is what the graph _means_, not always the characters it was
written with. Desmos keeps whatever spacing an author typed — `\ ` between two
arguments — and Axis has no way to say that, so a decompiled graph closes those
up. A bare run of points comes back as the list it is, and a fraction written
beside a name comes back with the name in its numerator, which is the same
number. The check that matters is that a real calculator reads the two graphs
the same way, which is what `packages/harness/test/decompile.test.mts` asks it.

`convertFromLatex` is the expression-level half of it, and the inverse of
`convertToLatex`.

## Writing a changed graph back

A Desmos graph is not only something a script produces; it is something a person
edits. Dragging a point moves it, dragging a slider re-numbers it, the colour
picker recolours it — and every one of those is a change the script it came from
now disagrees with.

Decompiling the whole graph and writing that out would close the gap and would
throw away everything a script has that a graph does not: the comments, the
blank lines, the macros, the folders an import stands for. So `writeBackGraph`
works a statement at a time, and returns the line ranges to replace:

```ts
import { applySourceEdits, compileAxis, writeBackGraph } from '@axis-dsl/compiler';

const compiled = compileAxis(source, { path: 'main.axis' });

// Applied to a calculator, then read straight back: Desmos normalises what it
// is given, so the baseline has to be its answer rather than what it was sent.
calculator.setState(/* … */);
const before = reading(calculator);

// …the user drags something…

const { edits, skipped } = writeBackGraph(
  compiled,
  before,
  reading(calculator),
  new Map([['main.axis', source]]),
);

const updated = applySourceEdits(source, edits);
```

What makes it possible is the **source map**. `compileAxis` returns one:
every expression id against the file and the lines the statement covers.

```ts
compiled.sourceMap.get('expr_2');
// { path: 'main.axis', line: 6, endLine: 9, writable: true }
```

Ids are the other half. The compiler stamps each expression with one, `setState`
keeps it and `getState` hands it back, so a point dragged halfway across the
graph is still recognisably the statement it came from.

**What cannot be written is reported rather than attempted.** Every refusal
comes back in `skipped` with a reason:

- a statement a **macro** expanded into — the text on those lines is not what
  the compiler read, so rewriting it would replace the macro with its expansion
- **several statements sharing one line**, which a block written inline is —
  replacing the span would take the others with it
- an **animating slider** or a **running ticker**, which is the graph working
  rather than somebody changing it; left in, a file would rewrite itself for as
  long as the tab was open
- a folder an **import** stands for, which is no `folder` statement to rewrite
- a **picture added in Desmos**, which arrives carrying its own bytes — a script
  has no `image` statement meaning "these bytes", only ones that name a file or
  a URL, so writing it out would put the whole picture into the source

Two things it is careful about, both of which cost a script something real if
they are got wrong:

- **A property Desmos did not hand back is not a property that was removed.** A
  slider written `{min: 0, max: 10}` comes back carrying only the min, because
  10 is Desmos' own default. So a statement is rewritten from its own expression
  with the change laid over it, never from the calculator's answer alone —
  otherwise dragging that slider would delete `max: 10` from somebody's script.
- **A picture's URL is not the picture's URL.** `image "./beach.png"` is read
  off a disk and inlined as a `data:` URI before the graph exists, so the graph
  carries the bytes and the path is gone. Dragging a picture is a real edit and
  is written; the name it was written with comes back from the source, never
  from the graph, or the filename would be replaced by a megabyte of base64.
- **The viewport is only written for a script that framed itself.** Panning and
  zooming are how anybody reads a graph. A script with no `xmin` in its config
  does not grow four lines about one the first time somebody scrolls.

The statement that does get rewritten keeps its indentation, its trailing
comment, its `#{ … }` block if it had one, and the order its properties were
written in.

## API

| Export                                            |                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `compileAxis(script, options?)`                   | The compiler. Returns a `CompilationResult`                                          |
| `loadImports(entry, host)`                        | Reads every file reachable by `import`, transitively; returns a `Map` keyed by path  |
| `createImportResolver(files, resolve)`            | Turns that `Map` into the synchronous `resolveImport` the compiler wants             |
| `findImports(source)`                             | Just the specifiers one file imports, in order                                       |
| `loadImages(entry, files, host)`                  | Reads every image file the script and its imports draw; returns a `Map` of data URIs |
| `createImageResolver(images, resolve)`            | Turns that `Map` into the synchronous `resolveImage` the compiler wants              |
| `findImageFiles(source)`                          | Just the image paths one file draws, in order                                        |
| `loadProgram(source, options?)`                   | The first pass: the script and everything it imports, parsed                         |
| `collectSymbols(program)`                         | The second: every macro, style, function and variable the program defines            |
| `checkProgram(program, symbols)`                  | The third: every semantic diagnostic                                                 |
| `expandMacros(expression, macros)`                | One expression with its macros substituted, as trees                                 |
| `resolveProperties(entries, styles)`              | One metadata clause with its styles applied                                          |
| `definitionOf(expression)`                        | What a statement defines - a function, a variable - or nothing                       |
| `emitLatex(expression)` / `parseLatex(latex)`     | One expression tree to Desmos latex, and back                                        |
| `convertToLatex(expr)`                            | Axis 1's text-to-latex converter, kept for the v1 decompiler                         |
| `decompileAxis(graph, options?)`                  | The decompiler. A graph's `{ expressions, settings? }` back into `.axis` source      |
| `decompileExpression(expression, options?)`       | One expression as the statement that builds it - the decompiler's unit of work       |
| `decompileSettings(graph, options?)`              | Just the `config { … }` block a graph's settings decompile to                        |
| `graphActionNames(expressions)`                   | The names a graph defines as actions, which `decompileExpression` wants              |
| `writeBackGraph(compiled, before, after, files)`  | What changed on a live graph, as edits to the statements that produced it            |
| `diffGraphs(before, after)`                       | Just the changes between two readings of the same graph, by expression id            |
| `applySourceEdits(source, edits)`                 | Applies one file's edits to its text                                                 |
| `convertFromLatex(latex)`                         | One piece of Desmos LaTeX back into the Axis 1 expression it compiles from           |
| `DecompileInput` / `DecompileOptions`             | `{ expressions, settings? }` and `{ indent? }`                                       |
| `CompileOptions`                                  | `{ path?, resolveImport?, resolveImage? }`                                           |
| `CompilationResult`                               | `{ state, options, diagnostics, sourceMap, configOrigin?, dependencies }`            |
| `StatementOrigin`                                 | `{ path, line, endLine, span, writable, reason? }` - where one item was written      |
| `GraphSnapshot` / `GraphChange` / `SourceEdit`    | A reading of a graph, one change to it, and one replacement of a run of lines        |
| `WriteBackOptions` / `WriteBackResult`            | `{ include?, entryPath?, indent? }` and `{ edits, skipped }`                         |
| `ImportHost` / `ResolveImport` / `ResolvedImport` | The import resolver types                                                            |
| `ImageHost` / `ResolveImage` / `ResolvedImage`    | The image resolver types                                                             |

MIT
