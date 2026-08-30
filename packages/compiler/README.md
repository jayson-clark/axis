# @axis-dsl/compiler

Compiles [Axis](https://github.com/jayson-clark/axis) source into the
expressions, folders, tables and settings a Desmos graph is made of.

```sh
npm install @axis-dsl/compiler
```

## Usage

```ts
import { compileAxis } from '@axis-dsl/compiler';

const { expressions, settings } = compileAxis(`
config { showGrid: true }

"Basic functions"

f(x) = x^2 - 4x + 3     # color: #c74440
g(x) = sin(x) + cos(2x) # color: #2d70b3, lineWidth: 2
`);
```

`expressions` is a `DesmosExpression[]` and `settings` is the `config` block as
`CalculatorOptions` — both typed by
[`@axis-dsl/desmos`](https://www.npmjs.com/package/@axis-dsl/desmos).

## Applying the result

Apply the expressions with `setState`, not `setExpressions`:

```ts
calculator.setState({
    version: 11,
    graph: { viewport: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 } },
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

## API

| Export                                            |                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `compileAxis(script, options?)`                   | The compiler. Returns `{ expressions, settings?, imports }`                         |
| `loadImports(entry, host)`                        | Reads every file reachable by `import`, transitively; returns a `Map` keyed by path |
| `createImportResolver(files, resolve)`            | Turns that `Map` into the synchronous `resolveImport` the compiler wants            |
| `findImports(source)`                             | Just the specifiers one file imports, in order                                      |
| `convertToLatex(expr)`                            | One Axis expression to the LaTeX Desmos expects                                     |
| `CompileOptions`                                  | `{ path?, resolveImport? }`                                                         |
| `CompilationResult`                               | `{ expressions, settings?, imports }`                                               |
| `ImportHost` / `ResolveImport` / `ResolvedImport` | The resolver types                                                                  |

MIT
