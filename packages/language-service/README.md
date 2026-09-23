# @axis-dsl/language-service

Everything an editor asks about an [Axis](https://github.com/jayson-clark/axis)
file — diagnostics, completions, hover, formatting, semantic tokens, links,
go to definition, references, the outline and folding — as plain functions of
the source and a position, with a Monaco adapter on top.

```sh
npm install @axis-dsl/language-service
```

Nothing here touches an editor. Each service takes a document — the source, or
a `SyntaxTree` already parsed from it, so a host asking several questions of
one version parses it once — and a zero-based `{ line, character }` in UTF-16
units, which is how both the Language Server Protocol and Monaco count. What
comes back is editor-neutral data: ranges, markdown, edits. Two hosts adapt it:
[`./monaco`](#monaco) for a browser, and
[`@axis-dsl/language-server`](../language-server) for anything that speaks LSP,
which is what the VSCode extension runs.

The diagnostics are the compiler's own. The service does not keep a second
opinion about what is wrong with a file: it runs the parser and then
`compileAxis`, so an editor underlines exactly what a compile would report,
code for code.

## Usage

````ts
import { getCompletions, getDiagnostics, getHover, formatSource } from '@axis-dsl/language-service';

getDiagnostics('y = sine(x)\ncolor = 1 @ color: red');
// [{ code: 'unknown-function', severity: 'error', range, span, source: 'axis',
//    message: '`sine` is not a function - neither a built-in one nor one this file defines.' },
//  { code: 'invalid-color', …, message: "`red` is not a colour; the palette's names are capitalised: `RED`." }]

getHover('f(x) = x^2\ny = f(2)', { line: 1, character: 4 });
// { contents: '(function)\n\n```axis\nf(x) = x ^ 2\n```', range }

getCompletions('y = x @ col', { line: 0, character: 11 });
// [{ label: 'animationPeriod', kind: 'property', snippet: 'animationPeriod: ${1:8000}', … }, …]

formatSource('a=1;b=2'); // 'a = 1; b = 2'
````

Completions know where the cursor is — a property name after `@`, a value
after `color:`, a style after `use:`, a keyword at the start of a statement, a
name anywhere an expression goes — and offer what the manifest and the file
define there, the file's own names first. A snippet is a TextMate snippet
body, which VSCode and Monaco both expand natively.

### Imports

A file that imports another can use what it defines, so the services that
care — diagnostics, completions, hover, definitions, semantic tokens — take the
compiler's resolvers as `ProgramOptions`:

```ts
import { createImportResolver, loadImports } from '@axis-dsl/compiler';

const files = await loadImports({ path, source }, host);
const options = { path, resolveImport: createImportResolver(files, host.resolve) };

getDiagnostics(source, options);
getDefinition(source, position, options); // [{ uri: '/work/lib/waves.axis', range }]
```

The services are synchronous, and reading a file is not, so the reading is
done first with `loadImports` (and `loadImages`, for pictures) and handed in —
the same bargain `compileAxis` strikes. Without a resolver every import is
unresolved, as in a compile given none.

### Paths

Completing a path inside `import "…"` or `image "…"` is the one question the
language cannot answer alone, since what is in a directory is the host's to
know. Give `getCompletions` a synchronous `listDirectory` and it answers it;
a host that can only list asynchronously calls `getPathContext` to learn which
directory the cursor is in, lists it, and hands the entries to
`getPathCompletions`. `getDocumentLinks` finds every path in a document for a
ctrl-click, and `missingImportDiagnostic` / `missingImageDiagnostic` build the
squiggle for one the host looked for and did not find.

The path conventions themselves — `withAxisExtension`, `importTitle`,
`isImageUrl`, `imageMediaType`, `AXIS_IMAGE_EXTENSIONS` — live in
[`@axis-dsl/syntax`](../syntax) and are re-exported here for a host that
reaches for everything through this package.

## Monaco

```ts
import { registerAxisLanguage, AXIS_LANGUAGE_ID, AXIS_DARK_THEME } from '@axis-dsl/language-service/monaco';
import * as monaco from 'monaco-editor';

registerAxisLanguage(monaco);

monaco.editor.create(container, {
    value: 'y = x^2 @ color: RED',
    language: AXIS_LANGUAGE_ID,
    theme: AXIS_DARK_THEME,
});
```

`registerAxisLanguage` is the one call an app needs. It registers the `axis`
language on the Monaco instance you hand it — highlighting, bracket and comment
behaviour, completions, hover, formatting, semantic tokens, markers, go to
definition, references, highlights, the outline and folding — and defines the
`axis-dark` and `axis-light` themes. It is idempotent per instance, so an app
that creates several editors can call it freely, and it returns a disposable
that takes every provider away again.

It takes `RegisterAxisOptions`, all optional: `resolveImport` and
`resolveImage` with a `pathOf(model)` naming each model's file make imports
resolve across models; `semantic: false` limits the markers to syntax errors;
`semanticHighlighting: false` leaves Monaco's semantic colouring off, which is
otherwise switched on because Monaco's own themes leave it off and the tokens
would be computed and never drawn. The pieces are exported one by one —
`registerAxisCompletions`, `registerAxisDiagnostics` and the rest — for an app
that wants some of them and not others.

The app owns `monaco-editor`: the adapter imports only its types, and works on
whatever instance it is given. Axis ships no editor component,
because loading Monaco and wrapping it for a framework is app-shaped work every
bundler spells differently; [`examples/web/src/AxisEditor.tsx`](../../examples/web/src/AxisEditor.tsx)
is a React wrapper to copy, and [`examples/web/src/monaco.ts`](../../examples/web/src/monaco.ts)
the Vite loading and worker setup.

The TextMate grammar the extension highlights with ships here too, as
`@axis-dsl/language-service/syntaxes/axis.tmLanguage.json`.

## API

| Export                                                                    |                                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `getDiagnostics(doc, options?)`                                           | The parser's diagnostics and the compiler's, with ranges                      |
| `getCompletions(doc, position, options?)`                                 | What is worth offering at the cursor, paths included given `listDirectory`    |
| `getHover(doc, position, options?)`                                       | Markdown for the name, keyword or property under the cursor                   |
| `formatSource` / `formatDocument` / `formatRange`                         | The formatter, as text or as `TextEdit`s over the document or a range         |
| `getSemanticTokens(doc, options?)` / `getSemanticTokenList`               | Semantic tokens, LSP-encoded against `SEMANTIC_TOKEN_LEGEND`, or as a list    |
| `getDefinition` / `getReferences` / `getDocumentHighlights`               | Where a name is defined and used, across imports for a definition             |
| `getDocumentSymbols` / `getFoldingRanges`                                 | The outline and the folds                                                     |
| `getDocumentLinks(doc)`                                                   | Every import and image path, and every URL                                    |
| `getPathContext` / `getPathCompletions`                                   | Path completion, for a host that lists directories asynchronously             |
| `missingImportDiagnostic` / `missingImageDiagnostic`                      | The diagnostic for a path the host could not find                             |
| `compilerDiagnostics(tree, options?)` / `importedSymbols(tree, options?)` | The compiler's view of a document: what is wrong, and what its imports define |
| `analyze(tree)` / `cursorContext(tree, offset)`                           | The symbol table and cursor analysis the services are built on                |
| `toTree` / `spanToRange` / `rangeToSpan` / `toDiagnostic`                 | Converting between the tree's offsets and an editor's positions               |
| `AXIS_LANGUAGE_ID`, `AXIS_FILE_EXTENSION`, `AXIS_LANGUAGE_CONFIGURATION`  | What an editor registers the language under, and its bracket and word rules   |
| `KEYWORD_INFO`, `STATEMENT_KEYWORDS`                                      | What each keyword means, as hover and completions describe it                 |
| `./monaco`: `registerAxisLanguage(monaco, options?)`                      | Everything above, registered on a Monaco instance                             |
| `./monaco`: `AXIS_DARK_THEME`, `AXIS_LIGHT_THEME`, `defineAxisThemes`     | The `axis-dark` and `axis-light` themes                                       |
| `./monaco`: `createAxisMonarchLanguage`, `registerAxis…`                  | The grammar and each provider on its own                                      |

MIT
