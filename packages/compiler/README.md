# @axis-dsl/compiler

Compiles [Axis](https://github.com/jayson-clark/axis) source into the
expressions, folders, tables and settings a Desmos graph is made of.

```sh
npm install @axis-dsl/compiler
```

## Usage

```ts
import { compileAxis } from '@axis-dsl/compiler';

const { expressions, settings, graph } = compileAxis(`
config { showGrid: true }

"Basic functions"

f(x) = x^2 - 4x + 3     # color: #c74440
g(x) = sin(x) + cos(2x) # color: #2d70b3, lineWidth: 2
`);
```

`expressions` is a `DesmosExpression[]` and `settings` is the `config` block as
`CalculatorOptions` — both typed by
[`@axis-dsl/desmos`](https://www.npmjs.com/package/@axis-dsl/desmos).

`graph` is the rest of the `config` block: the viewport (`xmin`, `xmax`, `ymin`,
`ymax`) and `squareAxes`. They are separate because Desmos applies them
separately — it keeps the viewport in a graph's **state**, not in its
calculator's options, so `updateSettings({ xmin: 0 })` is not an error, it is
silence. Anything that renders a compilation has to apply both halves.

## Applying the result

`toGraph` assembles a compilation into the two things a calculator takes, and
applying it is two calls:

```ts
import { compileAxis, toGraph } from '@axis-dsl/compiler';

const { state, options } = toGraph(compileAxis(source));

calculator.setState(state);
// updateSettings has to follow setState, which resets the calculator's settings.
calculator.updateSettings(options);
```

`state` is the whole graph state: the expression list, the ticker beside it,
the viewport and `squareAxes`, and the top-level flags, with a viewport of
±10 filled in for a script that names none. `toGraph` is temporary - the
rewritten compiler returns `{ state, options }` from `compileAxis` itself - so a
host that applies what it returns and nothing else will not change when it goes.

Desmos has two shapes for an expression, and they are not interchangeable.
`setExpression` takes the API's; `setState` takes the serialized graph state's,
which is the only one that carries a folder — and folders are the reason Axis
compiles to the state form throughout. `folderId`, `collapsed`, `clickableInfo`
and `slider` all mean nothing to `setExpressions`, and mean nothing _quietly_:
a property in the wrong shape is dropped rather than reported.

## Imports

Compilation is synchronous and touches no filesystem, so a script with
`import "./waves.axis"` in it is handed a resolver rather than a path to go
reading. `loadImports` walks the import graph first over whatever reading a file
means where you are — `node:fs`, a VSCode workspace, a `Map` in a test:

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
const { expressions, settings, imports } = compileAxis(source, {
  path,
  resolveImport: createImportResolver(files, host.resolve),
});
```

The host owns `resolve` because only it knows what its paths mean — where a
leading `/` points, whether the `.axis` may be left off, what names a file.
Whatever it returns is compared for equality to detect cycles and handed back in
`imports`, so two specifiers naming the same file must resolve to the same
string.

`imports` names every file that was read, transitively. That is the set to watch
if the graph is live: a script is stale when anything it imports changes, not
only when it does.

A script that imports something and is given no resolver fails to compile,
rather than quietly dropping the import and graphing less than was asked for.

## Images

`image "./beach.png"` names a file the way an import does, and is reached the
same way — through a resolver, because the compiler still touches no filesystem.
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
const { expressions, images: drawn } = compileAxis(source, {
  path,
  resolveImage: createImageResolver(images, pictures.resolve),
});
```

The media type comes from the extension, and a file whose extension is not an
image's is an error rather than a picture a browser has to guess at. `images`
names every file that was inlined — the other half of the set to watch if the
graph is live.

An `image` that names something Desmos can already load — `https:`, `data:` —
reaches the graph exactly as it was written, and needs no resolver at all.

## Decompiling

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
| `compileAxis(script, options?)`                   | The compiler. Returns `{ expressions, settings?, imports, images }`                  |
| `loadImports(entry, host)`                        | Reads every file reachable by `import`, transitively; returns a `Map` keyed by path  |
| `createImportResolver(files, resolve)`            | Turns that `Map` into the synchronous `resolveImport` the compiler wants             |
| `findImports(source)`                             | Just the specifiers one file imports, in order                                       |
| `loadImages(entry, files, host)`                  | Reads every image file the script and its imports draw; returns a `Map` of data URIs |
| `createImageResolver(images, resolve)`            | Turns that `Map` into the synchronous `resolveImage` the compiler wants              |
| `findImageFiles(source)`                          | Just the image paths one file draws, in order                                        |
| `toGraph(compilation)`                            | A compilation as `{ state, options }`, for `setState` and `updateSettings`           |
| `convertToLatex(expr)`                            | One Axis expression to the LaTeX Desmos expects                                      |
| `decompileAxis(graph, options?)`                  | The decompiler. A graph's `{ expressions, settings? }` back into `.axis` source      |
| `decompileExpression(expression, options?)`       | One expression as the statement that builds it — the decompiler's unit of work       |
| `decompileSettings(graph, options?)`              | Just the `config { … }` block a graph's settings decompile to                        |
| `graphActionNames(expressions)`                   | The names a graph defines as actions, which `decompileExpression` wants              |
| `writeBackGraph(compiled, before, after, files)`  | What changed on a live graph, as edits to the statements that produced it            |
| `diffGraphs(before, after)`                       | Just the changes between two readings of the same graph, by expression id            |
| `applySourceEdits(source, edits)`                 | Applies one file's edits to its text                                                 |
| `convertFromLatex(latex)`                         | One piece of Desmos LaTeX back into the Axis expression it compiles from             |
| `DecompileInput` / `DecompileOptions`             | `{ expressions, settings? }` and `{ indent? }`                                       |
| `CompileOptions`                                  | `{ path?, resolveImport?, resolveImage? }`                                           |
| `CompilationResult`                               | `{ expressions, settings?, imports, images, sourceMap, configOrigin? }`              |
| `CompiledGraph`                                   | `{ state: GraphState, options: CalculatorOptions }`, what `toGraph` returns          |
| `StatementOrigin`                                 | `{ path, line, endLine, writable, reason? }` — where one expression was written      |
| `GraphSnapshot` / `GraphChange` / `SourceEdit`    | A reading of a graph, one change to it, and one replacement of a run of lines        |
| `WriteBackOptions` / `WriteBackResult`            | `{ include?, entryPath?, indent? }` and `{ edits, skipped }`                         |
| `ImportHost` / `ResolveImport` / `ResolvedImport` | The import resolver types                                                            |
| `ImageHost` / `ResolveImage` / `ResolvedImage`    | The image resolver types                                                             |

MIT
