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

Apply the expressions with `setState`, not `setExpressions`:

```ts
calculator.setState({
    version: 11,
    // The script's own viewport, over whatever framing you default to.
    graph: { viewport: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 }, ...graph },
    expressions: { list: expressions },
});

// updateSettings has to follow setState, which resets graph settings.
if (settings) {
    calculator.updateSettings(settings);
}
```

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
| `convertToLatex(expr)`                            | One Axis expression to the LaTeX Desmos expects                                      |
| `decompileAxis(graph, options?)`                  | The decompiler. A graph's `{ expressions, settings? }` back into `.axis` source      |
| `convertFromLatex(latex)`                         | One piece of Desmos LaTeX back into the Axis expression it compiles from             |
| `DecompileInput` / `DecompileOptions`             | `{ expressions, settings? }` and `{ indent? }`                                       |
| `CompileOptions`                                  | `{ path?, resolveImport?, resolveImage? }`                                           |
| `CompilationResult`                               | `{ expressions, settings?, imports, images }`                                        |
| `ImportHost` / `ResolveImport` / `ResolvedImport` | The import resolver types                                                            |
| `ImageHost` / `ResolveImage` / `ResolvedImage`    | The image resolver types                                                             |

MIT
