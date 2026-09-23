# @axis-dsl/syntax

The [Axis](https://github.com/jayson-clark/axis) language, read: the lexer, the
parser, the syntax tree, the printer that writes one back out, and the manifest
of every name the language knows.

```sh
npm install @axis-dsl/syntax
```

This is the bottom of the stack. The compiler lowers the tree it builds, the
language service answers an editor from it, and the decompiler builds trees of
its own and prints them with its printer — so there is one reading of the
language and one way of writing it, and every tool above agrees with every
other about what a script says. It depends on nothing, touches no filesystem
and no DOM, and runs anywhere.

[`docs/spec.md`](../../docs/spec.md) is the language this package reads;
[`src/ast.ts`](./src/ast.ts) is the shape of what it reads it into.

## Parsing

```ts
import { parse } from '@axis-dsl/syntax';

const tree = parse('a = 1 @ slider: -5..5 step 0.5\ny = a * sin(x) @ color: RED');

tree.file.statements; // two ExpressionStatements, each with its Metadata
tree.diagnostics; // []
tree.tokens; // every token, trivia included
```

Parsing never throws. A line it cannot read becomes an `ErrorStatement` or an
`ErrorExpression` and a diagnostic, and the parser picks up again at the next
newline or `;` — so an editor still sees every other statement in a file with
a typo in it, and a half-typed line costs that line, not the file:

```ts
parse('y = x +').diagnostics;
// [{ code: 'expected-expression', severity: 'error', message: 'Expected an expression',
//    span: { start: 7, end: 7 } }]
```

Every node carries a `span` of UTF-16 offsets into the source, and the tokens
are lossless — their text, concatenated, is the source exactly — which is what
lets the formatter keep comments where they were and write-back replace one
statement's characters and nothing else. `lineIndex(source)` turns offsets into
the zero-based line and character an editor counts in, and back.

`parseExpression` reads a lone expression the way a statement's value is read,
for a tool holding an expression rather than a file; `debugTree` prints a node
as an s-expression, which is the quickest way to see how something parsed:

```ts
debugTree(parseExpression('1/2x').expression); // (implicit (/ 1 2) x)
```

## Printing

```ts
import { format } from '@axis-dsl/syntax';

format('a=1 @ slider: -5..5 step 0.5\ny=a*sin(x)@color:RED,lineWidth:3\n');
// a = 1 @ slider: -5..5 step 0.5
// y = a * sin(x) @ color: RED, lineWidth: 3
```

`format` prints a file back from its tree by the rules in spec §10: spacing
round operators, metadata inline while it fits and a `@{ … }` block when it
does not, a long line broken at a bracket, comments and blank lines kept where
they were. A file with a syntax error is handed back exactly as it was, since a
formatter guessing at what a broken line meant is how code gets lost.

`printStatement` and `printExpression` are the same printer for a node built
from scratch: the decompiler writes a graph back as source through them, so
what it produces reads as though it were typed. Given no `Paren` nodes they add
exactly the brackets precedence needs to read back as the same tree.
`sameTree` compares two trees for meaning — spans, brackets, and whether
metadata was inline or a block set aside — which is how the round-trip tests
tell a layout change from a change in what a script says.

## The manifest

Every function, operator, constant, metadata property and config setting is
declared once, in `AXIS_MANIFEST`, and everything else reads it: the checker
rejects `color: red` from it, completions offer from it, and the compiler finds
a function's latex in it. Adding a name to the language is one edit here — and
a test in the harness, whose suites are driven from this list and fail on a
name nothing exercises.

Each property says what its value must be (`valueType`) and where it may be
written (`appliesTo`), so the lookups answer the questions the checker asks:

```ts
import { findProperty, placementsOf, propertiesFor } from '@axis-dsl/syntax';

findProperty('color', 'expression')?.valueType; // 'color'
propertiesFor('folder').map(property => property.name); // ['hidden', 'secret', 'collapsed']
placementsOf('playing'); // ['expression', 'ticker', 'style']
```

## Paths

What the quoted path of an `import` or an `image` names is the language's to
say (spec §7), so it lives here too, where every host can reach the one copy:
`withAxisExtension` adds the `.axis` an import may leave off, `importTitle` is
the folder name an import takes by default, `isImageUrl` tells a URL Desmos can
load from a path beside the script, and `imageMediaType` knows a picture by its
extension.

## API

| Export                                                               |                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `parse(source)`                                                      | A `SyntaxTree`: `{ source, tokens, file, diagnostics }`                              |
| `parseExpression(source)`                                            | One expression, read as a statement's value: `{ expression, tokens, diagnostics }`   |
| `lex(source)`                                                        | The tokens alone, trivia included, and the lexer's diagnostics                       |
| `unescapeString(text)`                                               | A string token's text as the value it stands for                                     |
| `KEYWORDS`, `isTrivia`                                               | The reserved words, and whether a token is whitespace or a comment                   |
| `format(source, options?)`                                           | The file formatted; `{ indent, maxLineLength }`, four spaces and 100 by default      |
| `printStatement(node, options?)` / `printExpression(node)`           | A node as canonical Axis text                                                        |
| `sameTree(a, b)` / `stripParens(node)`                               | Trees compared for meaning rather than layout                                        |
| `lineIndex(source)`                                                  | Offsets to `{ line, character }` and back                                            |
| `debugTree(node)`                                                    | A node as an s-expression, for tests and debugging                                   |
| `AXIS_MANIFEST`                                                      | Every function, operator, constant, property and setting                             |
| `findProperty`, `propertiesFor`, `placementsOf`, `enumValue`         | The manifest's lookups, by name and placement                                        |
| `AXIS_PALETTE`, `AXIS_PALETTE_HEX`                                   | The palette names `color` takes, and their hex                                       |
| `AXIS_DEFAULT_CONFIG`, `AXIS_DEFAULT_STATE`                          | The settings and state flags Axis applies where Desmos' own default is not the one   |
| `getFunctionLatex`, `AXIS_LATEX_FOR_CONSTANT`                        | How a builtin is spelled in latex                                                    |
| `AXIS_FILE_EXTENSION`, `withAxisExtension`, `importTitle`            | What an import names                                                                 |
| `isImageUrl`, `imageMediaType`, `AXIS_IMAGE_EXTENSIONS`              | What an image names                                                                  |
| `File`, `Statement`, `Expression`, `Metadata`, `Property`, `Span`, … | The node types, from [`src/ast.ts`](./src/ast.ts)                                    |
| `Diagnostic`                                                         | `{ code, severity, message, span, path? }`, the type every stage reports problems in |

MIT
