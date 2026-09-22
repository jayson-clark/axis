# Axis 2 — language specification

Axis is a language that compiles to Desmos graphs. This document is the
contract the v2 implementation is built against: the lexer, the parser, the
checker, the compiler and every editor service read the language the way it is
written here, and where the code and this document disagree, one of them is a
bug.

The syntax tree the parser produces is defined in
[`packages/syntax/src/ast.ts`](../packages/syntax/src/ast.ts); this document
refers to its node kinds by name.

## 1. A taste

```
// A comment runs to the end of the line.
config { showGrid: true; xmin: -7; xmax: 7 }

style emphasis { color: RED; lineWidth: 4 }
macro wave(k, phase) = sin(k * x + phase)

"A note"

folder "Waves" { @ collapsed
    a = 1 @ slider: -5..5 step 0.5
    y = a * wave(2, tau / 4) @ use: emphasis
    y = wave(1, 0) @{
        color: rgb(40, 120, 200)
        lineStyle: DASHED
    }
}

table { x = [1, 2, 3]; y = [1, 4, 9] @ lines }

n = 0
ticker n -> n + dt @ minStep: 50, playing
```

## 2. Lexical structure

Source is UTF-16 text; every position in the implementation is a UTF-16 offset.

### 2.1 Trivia

- **Whitespace**: spaces, tabs, `\r`.
- **Comments**: `//` to the end of the line. There are no block comments.
- **Newlines** are _not_ trivia. A newline is a token, and it ends a statement
  (§3.1) — except inside an open `(`, `[` or expression `{` (§2.4), where the
  lexer still emits it but the parser skips it.

The lexer keeps trivia in the token stream, so the concatenation of every
token's text is the source, exactly. Lexing never fails: anything it cannot
read becomes an `error` token and a diagnostic.

### 2.2 Tokens

| Token        | Examples                                                                    | Notes                                                                                |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `number`     | `3`, `0.5`, `.5`, `1e-3`                                                    | No sign; `-` is an operator. `1e-3` is one token only when a digit follows `e`/`e-`. |
| `identifier` | `x`, `amp`, `x_1`, `x_12`, `theta`                                          | `[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)?`                                               |
| `string`     | `"a \"b\" c"`                                                               | Escapes: `\"`, `\\`, `\n`. Unterminated at end of line is an error.                  |
| `color`      | `#c74440`, `#fff`                                                           | `#` followed by exactly 3 or 6 hex digits. Any other `#` is an error.                |
| keywords     | `folder table config import image ticker style macro as for with step soft` | Reserved: never identifiers. `min`/`max` are contextual (§4.4), not keywords.        |
| punctuation  | `( ) [ ] { } , ; : . .. ... = < <= > >= + - * / ^ ! \| -> @ @{`             | `@{` is one token only with no space between.                                        |
| `newline`    |                                                                             |                                                                                      |
| `error`      |                                                                             | Anything else.                                                                       |

`..` and `...` are distinct: `...` is Desmos' list range (`[1...10]`), `..` is
the Axis range literal (§4.4).

### 2.3 Identifiers

An identifier is written as the author wants it read; the compiler turns it
into Desmos' spelling:

- one letter stays itself: `x` → `x`
- more than one becomes a subscript: `amp` → `a_{mp}`, `L1` → `L_{1}`
- an explicit subscript is braced: `x_1` → `x_{1}`, `x_12` → `x_{12}`
- a Greek letter or constant from the manifest becomes its command: `theta` →
  `\theta`, and `theta2` → `\theta_{2}`

### 2.4 Brackets and continuation

`(` `[` always open an expression bracket. `{` opens an **expression** bracket
(a piecewise, §5.8) except where the grammar expects a **block** — after a
block keyword (`folder`, `table`, `config`, `style`), and as `@{`. Inside an
expression bracket newlines do not end anything, so a long list or piecewise
may be spread over lines freely. Inside a block they separate entries.

## 3. Statements

### 3.1 Separation

A statement ends at a newline or at `;`. That holds at the top level and inside
every block. Blank statements (two separators in a row) are ignored.

```
a = 1; b = 2          // two statements
table { x = [1, 2]; y = [3, 4] }
```

A comma never separates statements. Commas belong to expressions: points,
lists, calls, action runs, and `with`/`for` bindings.

### 3.2 Statement forms

```ebnf
file        = { separator } { statement { separator } } ;
separator   = newline | ";" ;

statement   = config | folder | table | style | macro
            | import | image | ticker | note | expressionStatement ;

config      = "config" "{" { separator } { property { separator } } "}" ;
folder      = "folder" [ string ] "{" [ metadata ] { separator } { statement { separator } } "}" ;
table       = "table" "{" [ metadata ] { separator } { column { separator } } "}" ;
column      = expression [ metadata ] ;
style       = "style" identifier "{" { separator } { property { separator } } "}" ;
macro       = "macro" identifier [ "(" [ identifier { "," identifier } ] ")" ] "=" expression ;
import      = "import" string [ "as" string ] [ metadata ] ;
image       = "image" string [ metadata ] ;
ticker      = "ticker" actionRun [ metadata ] ;
note        = string [ metadata ] ;
expressionStatement = statementExpression [ metadata ] ;
```

Notes on each:

- **`config`** — entries are properties (§4). A file has at most one. Only at
  the top level.
- **`folder`** — the title is optional: `folder { … }` is an untitled folder.
  Folders do not nest (Desmos has one level), so a `folder` inside a `folder`
  is an error. A metadata clause **immediately after the `{`** (before the
  first separator) annotates the folder itself.
- **`table`** — each entry is a column. `x = [1, 2, 3]` is a column with a
  header and values; a bare expression (`x ^ 2`) is a computed column. The
  same after-`{` rule gives the table metadata; a column's own metadata trails
  it.
- **`style`** — a named, reusable set of properties (§4.5). Top level only.
- **`macro`** — §6. Top level only.
- **`import`** — §7.
- **`image`** — the string is a path, an `http(s):` URL, or a `data:` URI.
- **`ticker`** — the graph's ticker. Its handler is an action or an action run.
  Top level only; a graph has one. `dt` (milliseconds since the last tick) is
  available inside the handler.
- **`note`** — a string on its own is a text note.
- **expression statement** — everything else: a definition (`f(x) = x^2`,
  `a = 1`), an equation or inequality (`y = x`, `y < x`), a point, a list, a
  bare expression, an action run.

## 4. Properties and metadata

### 4.1 Metadata

Metadata styles the statement it trails.

```ebnf
metadata     = "@" property { "," property }                        (* inline *)
             | "@{" { separator } { property { separator } } "}" ;  (* block *)
property     = identifier [ ":" propertyValue ] ;
propertyValue = range | expression ;
```

A property with no value is a **bare flag** and means `true`. Any boolean
property may be written bare: `@ hidden, fill`.

**Comma rule.** Inside an inline `@ …`, a comma starts a new property only if
what follows it is `identifier :` or a bare identifier followed by `,`, a
separator or the end. Otherwise the comma belongs to the value. So:

```
(1, 2) @ onClick: a -> 1, b -> 2, color: RED
//        └──────── one value ───┘  └ property ┘
```

Inside `@{ … }` and in `config`/`style` blocks properties are separated by
newlines or `;`, and commas are always part of the value.

### 4.2 Value types

Every property has a `valueType` in the manifest, and the checker enforces it:

| `valueType`  | Accepts                                  | Lowered as                          |
| ------------ | ---------------------------------------- | ----------------------------------- |
| `expression` | any expression                           | latex (`lineWidth: a + 1` is legal) |
| `number`     | a numeric literal, optionally negated    | a JSON number (config only)         |
| `string`     | a string literal                         | the string                          |
| `boolean`    | `true`, `false`, or bare                 | a boolean                           |
| `enum`       | one of the manifest's listed identifiers | the identifier's text               |
| `color`      | §4.3                                     | `color` or `colorLatex`             |
| `range`      | §4.4                                     | the Desmos bounds object            |
| `action`     | an action or action run                  | latex                               |
| `style`      | a style name                             | resolved away (§4.5)                |

### 4.3 Colours

`color` accepts three things:

- a hex literal `#rgb` / `#rrggbb` → `color: "#rrggbb"`
- a Desmos palette name — `RED`, `BLUE`, `GREEN`, `PURPLE`, `ORANGE`,
  `BLACK` → `color` set to that palette colour's hex
- **any other expression** — `rgb(255, 0, 0)`, `hsv(h, 1, 1)`, a variable `c`
  → `colorLatex` set to the expression's latex

There is no separate `colorLatex` property.

### 4.4 Ranges

```ebnf
range = [ expression ] ".." [ expression ] [ "step" expression ] [ "soft" [ "min" | "max" ] ] ;
```

- Either end may be left off to keep Desmos' default for it: `..5`, `0..`.
- Every end and the step may be any expression: `-a..a step a / 10`.
- Ends are **hard** by default (the slider will not go past them). `soft`
  makes both ends soft; `soft min` / `soft max` just the one.
- `min` and `max` are contextual words here, not keywords.

Ranges are the value of `slider`, `domain`, `parametricDomain` and
`polarDomain`.

```
a = 1 @ slider: -5..5 step 0.5
b = 0 @ slider: 0.. soft
t = 0 @ slider: 0..2pi soft max, playing
(cos(t), sin(t)) @ domain: 0..tau
```

### 4.5 Styles

```
style swatch { pointSize: 14; showLabel }
style loud { use: swatch; color: RED }

(-2, 1) @ use: swatch, color: BLUE
```

`use: name` may appear any number of times in one metadata clause or style;
styles are applied in the order written, and the clause's own properties win
over every style it uses. Styles may use other styles; a cycle is an error.
Style names are global across the compilation (including imports), like
macros, and live in their own namespace.

### 4.6 Placement

Which properties are legal where is the manifest's business: expression
metadata, folder metadata, table metadata, column metadata, image metadata,
ticker metadata, import metadata and config entries each have their own list.
A property in the wrong place is an error.

## 5. Expressions

### 5.1 Precedence

Loosest first. Everything is left-associative unless noted.

| Level | Forms                                                                       | Node                                          |
| ----- | --------------------------------------------------------------------------- | --------------------------------------------- |
| 1     | `body with a = 1, b = 2`, `body for i = L, j = M`                           | `With`, `For`                                 |
| 2     | action run `a -> 1, b -> 2` (statement values and `action` properties only) | `Sequence`                                    |
| 3     | `target -> value`                                                           | `Action`                                      |
| 4     | `= < <= > >=`, chainable: `1 < x < 2`                                       | `Comparison`                                  |
| 5     | `+ -`                                                                       | `Binary`                                      |
| 6     | `* /` **and implicit multiplication**                                       | `Binary` (`op: 'implicit'` for juxtaposition) |
| 7     | prefix `-`, `+`                                                             | `Unary`                                       |
| 8     | `^`, **right**-associative; the exponent may start with `-`                 | `Binary`                                      |
| 9     | postfix: call `f(…)`, index `L[…]`, member `.x`/`.count`, `!`               | `Call`, `Index`, `Member`, `Factorial`        |
| 10    | atoms                                                                       | see §5.2                                      |

Consequences, all deliberate:

```
1/2x     = (1/2)·x        → \frac{1}{2}x
a/b^2    = a/(b^2)        → \frac{a}{b^{2}}
x^2/3    = (x^2)/3        → \frac{x^{2}}{3}
a/b/c    = (a/b)/c        → \frac{\frac{a}{b}}{c}
-x^2     = -(x^2)         → -x^{2}
2^-1     = 2^(-1)         → 2^{-1}
x^10                      → x^{10}
2^3^2    = 2^(3^2)
```

Implicit multiplication is juxtaposition of two operands with nothing between
them: `2x`, `2pi x`, `3cos(t)`, `(a)(b)`, `x y`.

### 5.2 Atoms

| Form                                  | Node                                         |
| ------------------------------------- | -------------------------------------------- |
| `3`, `0.5`                            | `Number`                                     |
| `x`, `amp`, `theta`                   | `Identifier`                                 |
| `"text"`                              | `String`                                     |
| `#c74440`                             | `Color`                                      |
| `(e)`                                 | `Paren`                                      |
| `(a, b)`, `(a, b, c)`                 | `Tuple` (a point)                            |
| `[a, b, c]`, `[1...10]`, `[1, 3...9]` | `List` (with `ListRange` elements for `...`) |
| `[f(i) for i = [1...10]]`             | `List` holding a `For`                       |
| `{c1: v1, c2: v2, v3}`, `{x > 0}`     | `Piecewise`                                  |
| `\|e\|`                               | `Abs`                                        |

### 5.3 Calls and products

`name(args)` where `name` is an identifier parses as a `Call` node. Whether it
is really a call is decided by the checker: a builtin or a user-defined
function makes it a call; anything else with exactly one argument is a product
(`a(b + 1)` is `a·(b + 1)`) and the checker marks it so. Both spellings lower
to the same latex, so the distinction matters only for diagnostics.

Only identifiers are callable. `(f)(x)` is a product.

### 5.4 Members

`.name` after an expression is a `Member`: point coordinates (`P.x`, `P.y`) and
list statistics written postfix (`L.count`, `L.mean`) — any single-argument
function in the manifest may be used this way.

### 5.5 Comparisons and definitions

`=` is a comparison at the syntax level; what it _means_ is the checker's call:

- `f(x) = …` where the left is a call on fresh identifiers: a function
  definition
- `a = …` where `a` is an identifier other than `x`, `y` (or `r`, `theta` in
  polar form): a variable definition
- anything else: an equation

The same goes for regression `~`, which v2 does not yet support.

### 5.6 Actions

`a -> e` is an action; `a -> 1, b -> 2` is an action run (a `Sequence`). A
definition whose value is an action run names it: `R = a -> 1, b -> 2`. A
sequence of names that are themselves actions is also a run: `R = A, B`.

### 5.7 `with` and `for`

`for` binds list variables for a comprehension; `with` substitutes values into
the expression before it. Both take a comma-separated run of `name = value`
bindings that extends to the end of the enclosing bracket or statement.

### 5.8 Piecewise

`{condition: value, condition: value, otherwise}`; a branch without `: value`
is a restriction (`{x > 0}`). A piecewise immediately after an expression is an
implicit product and reads as a domain restriction: `y = x^2 {x > 0}`.

## 6. Macros

```
macro TAU2 = 2tau
macro wave(k, phase) = sin(k * x + phase)
```

A macro is an **expression** with a name. A use of it — `TAU2`, `wave(2, 0)` —
is replaced by its body **in the syntax tree**, with the arguments substituted
for the parameters as trees. Because substitution happens on trees, precedence
is never an issue: `macro double(a) = 2 * a` used as `double(1 + 2) ^ 2` is
`(2 · (1 + 2))²`.

- Macros are hoisted: in scope for the whole compilation, including every file
  imported and every file importing the one that defines it.
- Two definitions of one name are an error, even if identical.
- A macro name shadows nothing: it may not collide with a builtin, a user
  function or variable, or another macro.
- Arity must match; a parameterless macro is used without parentheses.
- Recursion (direct or mutual) is an error.
- A macro expands only in expression positions; it cannot stand for a
  statement, a block or metadata. Reusable metadata is what styles are for.
- A statement containing an expansion is not writable back from the graph
  (the graph holds the expansion, not the call).

## 7. Imports

```
import "./lib/waves"                      // folder titled "waves"
import "./lib/waves.axis" as "Waves"
import "./lib/waves" @ collapsed: false
```

The path is relative to the importing file; a leading `/` is relative to the
workspace root; `.axis` may be omitted. The imported file's statements land in
one folder of their own, **flattened**: folders inside it are dropped and
their contents join the import's folder. An import inside a folder joins that
folder rather than opening one. Import folders start collapsed.

The imported file's `config` applies too, with the importing file's settings
winning; likewise the importing file's ticker replaces an imported one. A cycle
is an error.

## 8. Diagnostics

Every problem is a diagnostic with a stable `code`, a severity, a message and
a span. The parser, the checker and the compiler all produce the same type,
and the compiler never throws on bad input: it returns every diagnostic it
found alongside whatever graph it could still build.

Errors include, beyond syntax:

- an unknown function (`notAFunction(x)`) — a call on a name that is neither a
  builtin nor a user function, with more than one argument or in call position
  where a product is impossible
- assigning to a builtin (`mean = 3`)
- a property that does not exist, is not allowed where it is written, or has a
  value of the wrong type (`color: red`, `lineWidth: 2 +`)
- misplaced `config`, `ticker`, `style`, `macro`; nested folders; a second
  `config` in one file
- macro and style errors (§4.5, §6)
- an import or image that cannot be resolved, or an import cycle

An undefined _variable_ is not an error: Desmos offers it as a slider.

## 9. Output

`compileAxis` returns:

```ts
interface CompilationResult {
    state: GraphState;            // the whole setState payload: list, ticker, graph, top-level flags
    options: CalculatorOptions;   // updateSettings
    diagnostics: Diagnostic[];
    sourceMap: Map<string, StatementOrigin>;
    configOrigin?: StatementOrigin;
    dependencies: { imports: string[]; images: string[] };
}
```

A host applies it with `calculator.setState(state)` and
`calculator.updateSettings(options)` — nothing else.
