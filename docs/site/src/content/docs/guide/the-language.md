---
title: The language
description: A tour of Axis, statement by statement.
sidebar:
  order: 1
---

An Axis script is a list of statements. Each one becomes one item in the
graph, whether an expression, a note, a folder or a table, in the order it is
written - so the script reads top to bottom the way the expression list does.

```axis
// A comment runs to the end of the line, and never reaches the graph.
"A note is a string on its own."

f(x) = x ^ 2 - 4x + 3
c = 3
y = c * x - 4
```

## Statements end at a newline

A statement ends at the newline after it, or at a `;`, so two short ones may
share a line. That holds at the top level and inside every block: a `folder`, a
`table`, a `config`, a `style` or an `@{ … }` block.

```axis
a = 1; b = 2
y = a x + b
```

A comma never separates statements - commas belong to expressions: points,
lists, calls, action runs, and the bindings of `with` and `for`. Inside an open
bracket a newline ends nothing, so a long list or piecewise may spread over as
many lines as it likes:

```axis
P = [
    (-2, 4),
    (0, 0),
    (2, 4),
] @ color: GREEN, pointSize: 14
```

Comments are `//` to the end of the line. There are no block comments.

## Definitions and equations

What `=` means depends on its left-hand side:

- `f(x) = …`, a call on fresh names, defines a **function**.
- `a = …`, where `a` is a name other than `x` or `y` (or `r` and `theta` in a
  polar equation), defines a **variable**.
- Anything else is an **equation**, and is graphed.

```axis
f(x) = x ^ 2 - 4x + 3
g(x) = f(2x - 1)
k = 0.5
y = k * g(x)
x ^ 2 + y ^ 2 = 9
y < x - 2
```

A function definition graphs as well as defining the function, and an
inequality shades the region where it holds. A statement need not have an `=`
at all: a point, a list of points, or `polygon(…)` on its own is drawn.

## Notes

A string on its own line is a note - the text card in Desmos' expression list.
It is how a graph explains itself to whoever opens it next, where a comment
explains the script to whoever reads it.

```axis
"Drag the slider to change the slope."
m = 1 @ slider: -3..3 step 0.1
y = m x
```

## Metadata

Anything after an `@` is metadata: how the statement it trails looks and
behaves. Properties are separated by commas, and when there are too many to sit
comfortably on the line, `@{ … }` gives them one line each.

```axis
y = x ^ 2 @ color: RED, lineWidth: 4
y = x ^ 3 @{
    color: BLUE
    lineStyle: DASHED
    label: "cubic"
}
k = 10 @ hidden
```

A property that is true or false may be written bare, as `hidden` is above,
and means `true`. [Styling](../styling/) covers the properties that change how
a statement looks, and the [property reference](../../reference/properties/)
lists every one and where it may be written.

## Folders

`folder "Title" { … }` groups the statements inside it. Desmos has one level of
folders, so a folder inside a folder is an error. The title is optional, and
metadata written immediately after the `{` belongs to the folder itself:

```axis
folder "Working values" { @ collapsed
    amp = 2 @ slider: 0..5 step 0.1
    freq = 3 @ slider: 1..8 step 1
}

y = amp * sin(freq * x)

folder { y = amp * cos(freq * x); y = amp }
```

A folder takes `collapsed`, `hidden` and `secret`. Metadata on a line of its
own anywhere else trails nothing, and is an error.

## Tables

`table { … }` is a Desmos table, one column per entry. `x = [1, 2, 3]` is a
column with a header and its values; the first column is what the others are
plotted against.

```axis
table {
    x = [1, 2, 3, 4, 5]
    y = [2, 4, 8, 16, 32] @ color: RED
}
```

[Tables and lists](../tables-and-lists/) has the rest of it: computed columns,
styling a whole table, and when a list is the better tool.

## Config

`config { … }` sets up the calculator itself rather than any one expression:
the grid and axes, the viewport, the theme, and which parts of the Desmos
interface appear. A script has at most one, at the top level.

```axis
config {
    showGrid: true
    xmin: -2
    xmax: 8
    xAxisLabel: "time (s)"
}

h(t) = 20t - 4.9t ^ 2
```

A compiled script is meant to be a finished graph rather than an editor, so
Axis leaves off the chrome desmos.com wraps around one: the settings menu, the
zoom buttons and the border are off, and the expression list starts collapsed.
`config` asks for any of them back - `zoomButtons: true`,
`expressionsCollapsed: false`, and so on. The
[settings reference](../../reference/settings/) lists every entry.

## The other statements

Four statements have pages of their own:

- `style` names a set of properties to reuse, and `macro` names an expression
  ([Macros and styles](../macros-and-styles/)).
- `import` brings another script in as a folder, and `image` places a picture
  ([Imports and images](../imports-and-images/)).
- `ticker` runs an action over and over for as long as the graph is open
  ([Sliders and animation](../sliders-and-animation/)).

`config`, `style`, `macro` and `ticker` belong at the top level; written inside
a folder, each is an error.
