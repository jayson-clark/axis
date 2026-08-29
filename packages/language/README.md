# @axis-dsl/language

The [Axis](https://github.com/jayson-clark/axis) language services —
completions, formatting, diagnostics, the grammar and the manifest — with
bindings for both VSCode and Monaco.

```sh
npm install @axis-dsl/language
```

## Three entry points

The main entry point has no editor dependency at all: it is plain functions over
strings, so it runs in a test, a build step or a server just as well as in an
editor. The bindings are subpaths, so importing one never pulls in the other.

```ts
import { validateAxis, formatAxisCode, getAxisCompletions } from '@axis-dsl/language';
import { registerAxisLanguage } from '@axis-dsl/language/monaco'; // browser
import { registerAxisLanguage } from '@axis-dsl/language/vscode'; // extension host
```

```ts
const problems = validateAxis(source); // [{ code, severity, message, line, ... }]
const tidy = formatAxisCode(source, { tabSize: 4, insertSpaces: true });
const items = getAxisCompletions(source, { line: 3, character: 8 });
```

Completions are context-sensitive without a parse: inside a `config` block only
config properties are offered, after a `#` on the line only metadata properties,
and otherwise everything in scope. Diagnostics carry an `AxisDiagnosticCode`, so
editors and tests can match on the rule rather than on its wording.

## In an editor

Monaco — `registerAxisLanguage` teaches an instance the whole language and
returns a disposable that unregisters everything it added. Call it once per
instance; a second call registers a second set of providers.

```ts
import * as monaco from 'monaco-editor';
import { registerAxisLanguage } from '@axis-dsl/language/monaco';

const disposable = registerAxisLanguage(monaco);
```

If you want the themed React component rather than raw Monaco, use
[`@axis-dsl/editor`](https://www.npmjs.com/package/@axis-dsl/editor), which does
this for you.

VSCode — the same call returns the disposables to push onto your extension's
subscriptions:

```ts
import { registerAxisLanguage } from '@axis-dsl/language/vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(...registerAxisLanguage());
}
```

Neither `monaco-editor` nor `@types/vscode` is a dependency of this package.
The subpaths type against them and take the API as an argument, so each binding
uses the instance its host already has rather than a second copy of its own.

The TextMate grammar and the language configuration ship as data, for a host that
declares them in a manifest rather than registering them in code:

```json
"@axis-dsl/language/syntaxes/axis.tmLanguage.json"
"@axis-dsl/language/language-configuration.json"
```

## Imports

`import "./waves.axis"` is parsed here, but not resolved here — only a host
knows what its paths mean. So this package finds the statements and builds the
diagnostic, and whoever did the looking reports it:

```ts
import { findImportStatements, missingImportDiagnostic } from '@axis-dsl/language';

for (const located of findImportStatements(source)) {
  if (!(await exists(located.specifier))) {
    report(missingImportDiagnostic(located));
  }
}
```

## The manifest

`AXIS_MANIFEST` is the single list of every function, constant, metadata
property and config property the language knows — name, detail, completion
snippet, and the LaTeX the compiler emits. Completions, the grammar and the
compiler all read from it, so a function is added in one place.

## API

| Export                                                                                  |                                                                                   |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `validateAxis(text)`                                                                    | Syntax diagnostics, in document order                                             |
| `formatAxisCode(text, options)`                                                         | Re-indent and normalise a whole document                                          |
| `formatAxisCodeWithIndent(...)` / `indentLevelOf(...)`                                  | The same, for a fragment at a known depth (range formatting)                      |
| `getAxisCompletions(text, position)`                                                    | Completions in context                                                            |
| `missingImportDiagnostic(located)`                                                      | The diagnostic for an import whose file is not there                              |
| `findImportStatements` / `parseImportStatement` / `importTitle` / `withAxisExtension`   | Reading `import` statements                                                       |
| `splitTopLevel` / `splitTrailingMetadata` / `joinContinuedLines` / `expandBlockEntries` | The layout services the compiler shares                                           |
| `AXIS_MANIFEST` and the `AXIS_*_NAMES` sets                                             | Every name the language knows                                                     |
| `getFunctionLatex(name)` / `AXIS_LATEX_FOR_CONSTANT`                                    | What the compiler emits for a name                                                |
| `AXIS_LANGUAGE_ID` / `AXIS_FILE_EXTENSION` / `AXIS_LANGUAGE_CONFIGURATION`              | The identifiers a host registers                                                  |
| `createDebouncer(ms)`                                                                   | The debouncer both editor bindings validate on                                    |
| `/monaco` → `registerAxisLanguage(monaco)`                                              | Plus `createAxisMonarchLanguage` and the individual `register*` calls             |
| `/vscode` → `registerAxisLanguage()`                                                    | Plus the providers, `registerAxisDiagnostics`, `resolveImportUri`, `importExists` |

MIT
