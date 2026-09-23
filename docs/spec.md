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

```axis
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
- **Comments**: `//` to the end of the line, not counting the `\r` of a
  `\r\n` line ending. There are no block comments.
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
| `identifier` | `x`, `amp`, `x_1`, `x_12`, `theta`                                          | `[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*` (see below)                                   |
| `string`     | `"a \"b\" c"`                                                               | Escapes: `\"`, `\\`, `\n`. Unterminated at end of line is an error.                  |
| `color`      | `#c74440`, `#fff`                                                           | `#` followed by exactly 3 or 6 hex digits. Any other `#` is an error.                |
| keywords     | `folder table config import image ticker style macro as for with step soft` | Reserved: never identifiers. `min`/`max` are contextual (§4.4), not keywords.        |
| punctuation  | `( ) [ ] { } , ; : . .. ... = < <= > >= + - * / ^ ! \| -> @ @{`             | `@{` is one token only with no space between.                                        |
| `newline`    |                                                                             |                                                                                      |
| `error`      |                                                                             | Anything else.                                                                       |

`..` and `...` are distinct: `...` is Desmos' list range (`[1...10]`), `..` is
the Axis range literal (§4.4).

Details the table leaves open:

- **A decimal point needs a digit after it.** `0.5` and `.5` are numbers, but a
  number never takes a `.` that is not followed by a digit - so `0..5` is `0`
  `..` `5`, `0..` is `0` `..`, `1...10` is `1` `...` `10`, and `1.` is `1` and
  `.`.
- **An identifier may carry more than one `_` part** (`LOOP_FORWARD_REVERSE`,
  `above_left`), because Desmos spells some enum values that way and they have
  to be writable (§4.2). In an expression a name has at most one subscript
  (§2.3), and the checker reports `x_1_2`; the lexer reads it as one name so
  the error is about the name, not about a stray `_`.
- **A string escape other than `\"`, `\\` and `\n`** is an error
  (`invalid-escape`) and stands for the character after the backslash.
- **A bad colour** - `#` and anything but exactly 3 or 6 hex digits - is one
  `error` token covering the `#` and every letter and digit after it
  (`invalid-color`), so `#ff00` is one mistake rather than a colour and a name.
- **A run of characters the lexer does not know** is one `error` token and one
  `unexpected-character` diagnostic, not one per character.

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

```axis
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
  first separator) annotates the folder itself. Metadata anywhere else that
  trails nothing - on a line of its own - is an error (`misplaced-metadata`).
- **`table`** — each entry is a column. `x = [1, 2, 3]` is a column with a
  header and values; a bare expression (`x ^ 2`) is a computed column. The
  same after-`{` rule gives the table metadata; a column's own metadata trails
  it. Only `header = [ … ]` splits into a header and values: anything else,
  `x = 5` included, is a computed column as written, and the checker decides
  whether it can be one. Table metadata takes column properties, which apply
  to every column as defaults; a column's own metadata wins.
- **`style`** — a named, reusable set of properties (§4.5). Top level only.
- **`macro`** — §6. Top level only. The body is read as a statement's value
  is (§5.5), so it may be an action run: `macro reset = a -> 0, b -> 0`.
- **`import`** — §7.
- **`image`** — the string is a path, an `http(s):` URL, or a `data:` URI.
- **`ticker`** — the graph's ticker. Its handler is an action or an action run.
  Top level only; a graph has one. `dt` (milliseconds since the last tick) is
  available inside the handler.
- **`note`** — a string on its own is a text note. A string followed by
  anything but metadata or the end of the statement starts an expression
  instead.
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

The rule applies to every comma at the top of the value: those of an action
run and those between `with`/`for` bindings alike. Inside a bracket a comma
always belongs to the bracket.

Inside `@{ … }` and in `config`/`style` blocks properties are separated by
newlines or `;`, and commas are always part of the value - with one exception,
since it can never be part of one: a comma followed by `identifier :` is
reported as `comma-between-properties` and read as the separator it was meant
as, so `config { a: 1, b: 2 }` still has both entries.

The parser reads every property value the same way, whatever the property: an
expression, which may be an action run, or a range. Whether that is the right
kind of value for the property is the checker's business (§4.2), so
`color: RED, 3` parses (as a run) and is then rejected.

### 4.2 Value types

Every property has a `valueType` in the manifest, and the checker enforces it:

| `valueType`  | Accepts                                  | Lowered as                          |
| ------------ | ---------------------------------------- | ----------------------------------- |
| `expression` | any expression                           | latex (`lineWidth: a + 1` is legal) |
| `number`     | a numeric literal, optionally negated    | a JSON number                       |
| `string`     | a string literal                         | the string                          |
| `boolean`    | `true`, `false`, or bare                 | a boolean                           |
| `enum`       | one of the manifest's listed identifiers | the manifest's spelling of it       |
| `color`      | §4.3                                     | `color` or `colorLatex`             |
| `range`      | §4.4                                     | the Desmos bounds object            |
| `action`     | an action or action run                  | latex                               |
| `style`      | a style name                             | resolved away (§4.5)                |

`number` is for what Desmos holds as a JSON number rather than latex: most
`config` numbers, and a slider's `playDirection` and `animationPeriod`.

**Enums are case-insensitive.** The manifest lists each value as Desmos spells
it - `NONE`, `DASHED`, `LOOP_FORWARD`, but `above` and `linear` - and a value
written in any case is lowered to that spelling: `dragMode: none` is `NONE`,
`labelOrientation: ABOVE` is `above`.

### 4.3 Colours

`color` accepts three things:

- a hex literal `#rgb` / `#rrggbb` → `color: "#rrggbb"`
- a Desmos palette name — `RED`, `BLUE`, `GREEN`, `PURPLE`, `ORANGE`,
  `BLACK` → `color` set to that palette colour's hex
- **any other expression** — `rgb(255, 0, 0)`, `hsv(h, 1, 1)`, a variable `c`
  → `colorLatex` set to the expression's latex

There is no separate `colorLatex` property.

A hex literal is lowered written out in full and in lower case - `#ABC` is
`#aabbcc` - which is the only spelling Desmos writes back. Palette names,
unlike enum values, are **case-sensitive**, because any other spelling is an
expression: `color: red` is r·e·d. So a palette name in the wrong case is an
error (`invalid-color`) unless the file defines that name itself, in which
case it is the variable. A number, a string, an action or an equation is never
a colour.

The `config` colours - `backgroundColor`, `textColor`, `accentColor` - are
`color` too, but Desmos wants a hex string there, so they take only a hex
literal or a palette name, never an expression.

### 4.4 Ranges

```ebnf
range = [ expression ] ".." [ expression ] [ "step" expression ] [ "soft" [ "min" | "max" ] ] ;
```

- Either end may be left off to keep Desmos' default for it: `..5`, `0..`.
- Every end and the step may be any expression: `-a..a step a / 10`.
- Ends are **hard** by default (the slider will not go past them). `soft`
  makes both ends soft; `soft min` / `soft max` just the one.
- `min` and `max` are contextual words here, not keywords.
- `step` comes before `soft` when both are written.
- A range is only ever a whole property value: `..` anywhere else is an
  unexpected token. Its ends and step are read at the level of a comparison
  (§5.1), so nothing looser - an action, a run, a `with` - can be one.

Ranges are the value of `slider`, `domain`, `parametricDomain` and
`polarDomain`. A domain is its two ends and nothing else: `step` and `soft` on
one are an error (`invalid-value`). An end left off a domain is lowered as the
empty string Desmos stores for it.

```axis
a = 1 @ slider: -5..5 step 0.5
b = 0 @ slider: 0.. soft
t = 0 @ slider: 0..2pi soft max, playing
(cos(t), sin(t)) @ domain: 0..tau
```

### 4.5 Styles

```axis
style swatch { pointSize: 14; showLabel }
style loud { use: swatch; color: RED }

(-2, 1) @ use: swatch, color: BLUE
```

`use: name` may appear any number of times in one metadata clause or style;
styles are applied in the order written, and the clause's own properties win
over every style it uses. Styles may use other styles; a cycle is an error.
Style names are global across the compilation (including imports), like
macros, and live in their own namespace.

A style is checked as a style where it is defined, and where it is used for
what it cannot know there: a property it sets that the place it is used does
not take - `showLabel` from a style used on a table column - is
`misplaced-property`, reported against the `use:`. A statement that uses a
style stays writable back from the graph, since the `use:` is itself source.

### 4.6 Placement

Which properties are legal where is the manifest's business: expression
metadata, folder metadata, table metadata, column metadata, image metadata,
ticker metadata, import metadata and config entries each have their own list.
A property in the wrong place is an error.

| Placement  | Takes                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| expression | every styling, slider, domain, click and label property; `use`                                                                                                  |
| column     | `color`, `lineStyle`, `lineWidth`, `lineOpacity`, `pointStyle`, `pointSize`, `movablePointSize`, `pointOpacity`, `hidden`, `points`, `lines`, `dragMode`, `use` |
| table      | exactly what a column takes, as defaults for every column                                                                                                       |
| style      | anything an expression or a column takes, `slider` included                                                                                                     |
| folder     | `collapsed`, `hidden`, `secret`                                                                                                                                 |
| import     | `collapsed`, `hidden`, `secret`                                                                                                                                 |
| image      | `name`, `center`, `width`, `height`, `angle`, `opacity`, `foreground`, `hidden`, `secret`, `dragMode`, `onClick`, `clickable`                                   |
| ticker     | `minStep`, `playing`, `open`                                                                                                                                    |
| note       | `secret`                                                                                                                                                        |
| config     | the calculator settings, and nothing that goes anywhere else                                                                                                    |

`playing` is two properties: a slider's on an expression, the ticker's own on a
ticker. The manifest (`appliesTo`, `propertiesFor`, `findProperty`) is the
authority; this table is its summary.

A property may be given once per clause (`duplicate-property`); only `use` is
repeatable. An image's `dragMode` is lowered to the `draggable` flag Desmos
keeps for an image - any mode but `NONE` makes it draggable - because Desmos
ignores `dragMode` on one.

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
them: `2x`, `2pi x`, `3cos(t)`, `(a)(b)`, `x y`. An operand that starts with a
sign is never juxtaposed - `a -b` is a subtraction - and a `[` straight after
an operand indexes it rather than multiplying it. Inside `| … |` a `|` closes
the bar rather than opening a juxtaposed one.

**A statement's `=` is the exception to the table.** In an expression
statement, a macro body and a table column, `lhs = rhs` takes the rest of the
statement as its right-hand side at the loosest level there is - an action, a
run, a `with` or a `for`:

```
reset = E -> (2, -6), n -> 0   = reset = (E -> (2, -6), n -> 0)
R = A, B                       = R = (A, B)
f(x) = x n with n = 3          = f(x) = (x n with n = 3)
```

That is the only place `=` binds more loosely than `->` and `,`. A chain
(`1 < x < 2`), or an `=` inside a bracket, keeps its place in the table:
`(R = a -> 1)` is `((R = a) -> 1)`.

### 5.2 Atoms

| Form                                                  | Node                                         |
| ----------------------------------------------------- | -------------------------------------------- |
| `3`, `0.5`                                            | `Number`                                     |
| `x`, `amp`, `theta`                                   | `Identifier`                                 |
| `"text"`                                              | `String`                                     |
| `#c74440`                                             | `Color`                                      |
| `(e)`                                                 | `Paren`                                      |
| `(a, b)`, `(a, b, c)`                                 | `Tuple` (a point)                            |
| `[a, b, c]`, `[1...10]`, `[1, 3...9]`, `[1, ..., 10]` | `List` (with `ListRange` elements for `...`) |
| `[f(i) for i = [1...10]]`                             | `List` holding a `For`                       |
| `{c1: v1, c2: v2, v3}`, `{x > 0}`                     | `Piecewise`                                  |
| `\|e\|`                                               | `Abs`                                        |

Desmos' own spelling of a range with commas round the dots, `[1, ..., 10]` or
`[1, 3, ..., 9]`, is read as the same `ListRange` as `[1...10]` and
`[1, 3...9]`. A list spread over lines may end with a trailing comma, and so
may a call's arguments; a trailing comma in plain parentheses, `(a,)`, makes a
one-element `Tuple`. An index holds exactly one expression: `L[1, 2]` is an
error.

### 5.3 Calls and products

`name(args)` where `name` is an identifier parses as a `Call` node. Whether it
is really a call is decided by the checker: a builtin or a user-defined
function makes it a call; anything else with exactly one argument is a product
(`a(b + 1)` is `a·(b + 1)`) and the checker marks it so. Both spellings lower
to the same latex, so the distinction matters only for diagnostics.

A product needs a name Desmos reads as a value: a single letter, with or
without a subscript (`k(x - 1)`, `k_1(x)`); a variable the compilation
defines; a parameter or a `with`/`for` binding in scope; a constant or an
operator (`pi(2)`). A longer name that is none of those - `sine(x)` - is far
more likely a misspelt function than a coefficient nobody defined, so it is
`unknown-function`, as is a call on anything but a function with no arguments
or more than one.

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
is a restriction (`{x > 0}`). A trailing entry without `: value` is the
`otherwise` when some entry before it has a `:`; when none does, every entry
is a bare condition, so `{x > 0, x < 2}` is two restrictions. A piecewise
immediately after an expression is an
implicit product and reads as a domain restriction: `y = x^2 {x > 0}`.

## 6. Macros

```axis
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
- Recursion (direct or mutual) is an error. A macro that collides with a
  builtin or with a name the file defines is reported and left out, so the
  name keeps its other meaning everywhere it is used.
- A macro expands only in expression positions; it cannot stand for a
  statement, a block or metadata. Reusable metadata is what styles are for.
- A statement containing an expansion is not writable back from the graph
  (the graph holds the expansion, not the call).
- A macro's body is checked once, where it is defined, with its parameters in
  scope; a use is checked only for its arity. `dt` is allowed in a body, since
  a macro may be written for a ticker.

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
winning; likewise the importing file's ticker replaces an imported one (and of
several imported tickers, the last to be read). A cycle is an error
(`import-cycle`), reported against the import that closes it.

A file imported more than once is included the first time and is nothing the
other times, wherever the imports are: a second copy would define every name
in it again, which Desmos rejects. An import that cannot be resolved is
`unresolved-import`, and the rest of the file still compiles.

## 8. Diagnostics

Every problem is a diagnostic with a stable `code`, a severity, a message and
a span. The parser, the checker and the compiler all produce the same type,
and the compiler never throws on bad input: it returns every diagnostic it
found alongside whatever graph it could still build.

The lexer and parser report these codes. The parser never throws: it reports
what it could not read, resynchronises at the next newline or `;` (or the `}`
of the block it is in), and leaves an `ErrorStatement` or `ErrorExpression`
where the unreadable text was. One problem is reported once, however many
rules trip over it.

| Code                       | What                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `unexpected-character`     | a character no token starts with                                       |
| `unterminated-string`      | a string still open at the end of its line                             |
| `invalid-escape`           | a string escape other than `\"`, `\\`, `\n`                            |
| `invalid-color`            | `#` without exactly 3 or 6 hex digits                                  |
| `unexpected-token`         | a token no rule could use where it stands                              |
| `expected-expression`      | an operand, element or value missing                                   |
| `unclosed-bracket`         | a `(`, `[`, expression `{` or `\|` never closed                        |
| `unclosed-block`           | a block `{` or `@{` never closed                                       |
| `expected-block`           | a block keyword without its `{`                                        |
| `expected-identifier`      | a style or macro name, a macro parameter, or a member name missing     |
| `expected-string`          | an import path, `as` title or image source missing                     |
| `expected-equals`          | a macro without its `=`                                                |
| `expected-binding`         | `with` or `for` not followed by `name = value`                         |
| `expected-property`        | metadata or a block entry that does not start with a property name     |
| `expected-colon`           | a property name followed by something other than `:` or the next entry |
| `expected-value`           | `key:` with nothing after it                                           |
| `comma-between-properties` | block entries separated by a comma (§4.1)                              |
| `misplaced-metadata`       | metadata trailing nothing                                              |

An unclosed bracket costs one line rather than the file: brackets are paired
before parsing starts, and inside one that is never closed newlines end the
statement after all.

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

The checker and the compiler report these codes. Every one is an error, and
none of them stops the rest of the file compiling: a value that is wrong is
left off, and a statement that cannot be written at all is left out.

| Code                    | What                                                                             |
| ----------------------- | -------------------------------------------------------------------------------- |
| `unknown-function`      | a call on a name that is not a function (§5.3)                                   |
| `assign-to-builtin`     | defining a function, an operator, `pi`, `tau`, `e`, `infinity`, `true`/`false`   |
| `multiple-subscripts`   | a name in an expression with more than one `_` part (`x_1_2`)                    |
| `boolean-in-expression` | `true` or `false` in an expression - Desmos has no booleans                      |
| `dt-outside-ticker`     | `dt` anywhere but the ticker's handler (or a macro's body)                       |
| `unexpected-string`     | a string where a value belongs                                                   |
| `unknown-property`      | a property no placement has                                                      |
| `misplaced-property`    | a property this placement does not take, directly or through a style             |
| `duplicate-property`    | a property given twice in one clause                                             |
| `invalid-value`         | a value of the wrong type for its property (§4.2)                                |
| `invalid-enum`          | an enum value the property does not list                                         |
| `invalid-color`         | a colour that is not one (§4.3)                                                  |
| `unexpected-range`      | a range for a property that takes none                                           |
| `invalid-column`        | a table column that is an equation (`x = 5`)                                     |
| `misplaced-config`      | `config` inside a folder                                                         |
| `misplaced-ticker`      | `ticker` inside a folder                                                         |
| `misplaced-style`       | `style` inside a folder                                                          |
| `misplaced-macro`       | `macro` inside a folder                                                          |
| `nested-folder`         | a folder inside a folder                                                         |
| `duplicate-config`      | a second `config` in one file                                                    |
| `duplicate-ticker`      | a second `ticker` in one file                                                    |
| `duplicate-macro`       | a second macro of one name anywhere in the compilation                           |
| `macro-collision`       | a macro named after a builtin, a function or a variable                          |
| `macro-arity`           | a macro used with the wrong number of arguments, or with or without `()` wrongly |
| `macro-recursion`       | a macro that expands into itself                                                 |
| `duplicate-style`       | a second style of one name anywhere in the compilation                           |
| `unknown-style`         | `use:` naming no style                                                           |
| `style-cycle`           | a style that uses itself, reported at the `use:` that closes the loop            |
| `unresolved-import`     | an import that cannot be read                                                    |
| `import-cycle`          | an import that closes a cycle                                                    |
| `unresolved-image`      | an image file that cannot be read                                                |
| `invalid-image`         | an image path that is not a picture by its extension                             |

A diagnostic about an imported file carries that file's `path`, and its span
is into that file; one about the entry file carries none. A misplaced
`config` or `ticker` is not applied, and the contents of a nested folder join
the folder it is in.

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

So the state is complete. It is version 11; it carries
`doNotMigrateMovablePointStyle: true`, without which Desmos substitutes its
own style for any point it decides is movable; `includeFunctionParametersInRandomSeed`
at the top level, where Desmos reads it; the viewport under `graph`, with any
edge the file did not give filled in from ±10; and the ticker beside the list
only when there is one. The options are the Axis defaults under the merged
config, with `actions: true` added for a file with a ticker and no `actions`
of its own - Desmos decides `auto` from the list, which the ticker is not in.

Each item in the list has a deterministic id - `expr_N`, `folder_N`, `note_N`,
`table_N`, `image_N`, and `col_N` for a column, numbered in the order they are
lowered - and an entry in `sourceMap` saying where it was written:

```ts
interface StatementOrigin {
    path: string;       // the file, as the resolver named it
    line: number;       // zero-based, first line of the statement
    endLine: number;    // zero-based, last line, inclusive
    span: Span;         // the statement's exact characters, metadata included
    writable: boolean;  // false when a macro expanded into it
    reason?: string;
}
```

Two statements on one line have spans of their own, so sharing a line does not
make either unwritable.

## 10. Formatting

`format` (in `@axis-dsl/syntax`) prints a file back from its tree, so there is
one way every file is laid out. The decompiler and write-back print the nodes
they build with the same printer, so generated source looks typed by hand.

- **Spacing.** One space either side of `+ - * / ^ = < <= > >= ->` and after
  every comma and `:`. A sign sits against what it negates: `-x`, `2 - -3`,
  `2 ^ -1`. A range is written tight, `-5..5 step 0.5`, and a list range
  `[1...10]` - Desmos' `[1, ..., 10]` becomes that.
- **Juxtaposition.** A number sits against the name or bracket it multiplies
  (`2x`, `3cos(t)`, `2(x + 1)`, `2|x|`); anything else is spaced (`2pi x`,
  `x y`, `sin(x) cos(x)`), and a restriction always is (`x ^ 2 {x > 0}`). A
  name followed by a bracket would be a call (§5.3), so that product is written
  `(x)(a + b)`.
- **Brackets.** An author's brackets are kept. A tree built without any gets
  exactly the ones §5.1 needs to read back as itself.
- **Metadata** stays inline when it fits, and becomes a `@{ … }` block, one
  property to a line, when it does not and there is more than one property.
  Metadata written as a block stays one. A run whose bare names would read as
  flags inline (`onClick: A, B`) is always written as a block.
- **Blocks** written on one line stay on one line, entries separated by `; `,
  while they fit; otherwise one entry to a line, indented one level (four
  spaces by default). A folder's or a table's own metadata is written inline
  on the line of its `{`.
- **Wrapping.** A line longer than the width (100 by default) is broken at the
  first bracket of several elements that runs past it, one element to a line.
  A bracket the author opened onto a new line stays open.
- **Comments and blank lines** are kept where they were: on a line of their
  own, or after the entry whose line they end. A run of blank lines is one,
  and none is kept at the start or end of a block. A statement with a comment
  inside a bracket spread over lines is kept as written, re-indented.
- **Spelling** is the author's: enum values keep their case (§4.2), property
  order is as written, number literals keep their digits.
- A file with a syntax error is returned exactly as it was.

## 11. Decompiling

`decompileAxis({ state, options? })` is the compiler run backwards: a graph
state - what `compileAxis` hands a host, or what a calculator's `getState`
hands back - into Axis source, as `{ source, statements, diagnostics }`. It builds
the statements as tree nodes and prints them with the printer (§10), so the
source is already formatted and parses without a word. The contract is the
round trip: `compileAxis(decompileAxis(compileAxis(s)).source)` builds the same
`state` and `options` as `compileAxis(s)`.

- **Properties** are one `Property` each, in a fixed order: the slider and its
  animation, the colour, the styling, the labels, the domains, the click. A
  `true` boolean is a bare flag and a `false` one is written out.
- **Colours**: a hex that is a palette colour is its name, unless the graph
  defines that name itself; any other hex is a literal, in full and lower
  case; `colorLatex` is the expression. A calculator keeps a cycled `color`
  beside a `colorLatex`; the expression wins.
- **Ranges**: `slider` is `lo..hi step s`, an end Desmos left off is left off,
  and an end without its `hardMin`/`hardMax` is `soft` on that end. A domain
  end that is `""` is left off.
- **What lowering fills in is left out**: `movablePointSize` equal to
  `pointSize`, `parametricDomain` equal to `domain`, a viewport edge of ±10,
  an option or state flag equal to Axis' default, and `actions: true` beside a
  ticker. A state without `includeFunctionParametersInRandomSeed` is the
  legacy behaviour and is written `false`.
- **What a calculator adds is read back**: a point style stashed under
  `__stashed_V12PointStyle` is the `pointStyle`; the settings it mirrors into
  `graph` are config, with `options` winning; its `randomSeed` is kept only for
  a graph that calls `random` or `shuffle`.
- **Structure**: folders gather their members wherever the list keeps them; a
  folder with no title is `folder { … }`; a folder claiming to sit in another
  is written beside it. Tables write each column's own metadata, trailing
  blank cells trimmed. An image's `draggable` is `dragMode: XY`. The ticker is
  written last. A blank row is not written.
- **What a graph cannot say**: imports come back as the folders they were
  flattened into, macros and styles as what they expanded to, and an inlined
  picture as its `data:` URI.
- **Statements read as statements**: `g=a-b\operatorname{with}a=2,b=1` is how
  Desmos writes a definition whose value has bindings, and it is written
  `gap = a - b with a = 2, b = 1` (§5.1), not `(gap = a - b) with …`. A latex
  name that would close up into a keyword or `true`/`false` keeps its
  subscript apart: `f_{or}` is `f_or`.
- **What Axis cannot write** is reported, never thrown. Latex `parseLatex`
  has no reading for (`\sum`, `\int`, …) leaves out the expression - or only
  the property, if that is where it is - and a `// unsupported: <latex>`
  comment stands where it would have been. Every one is a warning whose span
  is that comment in `source`:

| Code                | What                                                           |
| ------------------- | -------------------------------------------------------------- |
| `unsupported-latex` | latex the expression tree has no node for                      |
| `unsupported-item`  | a list item Axis has no statement for, or an image with no URL |
| `unsupported-value` | a colour or enum value Axis cannot write, or a blank cell      |

`decompileExpression`, `decompileSettings` and `decompileTicker` hand back one
item's node - a folder as its header, with an empty body - for write-back to
print in place.
