---
title: Tables and lists
description: Tables, their columns and styling, and lists - the other way to hold many values.
sidebar:
  order: 6
---

Desmos has two ways to hold many values at once: a table, which is data laid
out in cells, and a list, which is one value made of many. Axis writes both.

## Tables

`table { … }` is a Desmos table, one entry per column. A column written
`name = [values]` has a header and its cells. The first column is what the
others are plotted against, and each of the others draws its values as points.

```axis
table {
    x = [1, 2, 3, 4, 5]
    y = [2, 4, 8, 16, 32] @ color: RED
}
```

Entries are separated by newlines or `;`, as in every block, so a short table
fits on one line. The two forms compile to the same table:

```axis
table { x = [0, 1, 2, 3]; y = [0, 1, 4, 9] @ color: BLUE, lines }
```

A table can have as many columns as it likes, each plotted against the first,
and the names need not be `x` and `y` - a column is named whatever its header
says, and the rest of the script can use it like any list:

```axis
table {
    t = [0, 1, 2, 3, 4, 5]
    pos = [0, 5, 20, 45, 80, 125] @ color: GREEN, lines, lineStyle: DASHED
    vel = [0, 10, 20, 30, 40, 50] @ color: ORANGE, pointStyle: OPEN, pointSize: 12
}

avg = mean(vel)
```

### Computed columns

A column with no values is a computed one: its expression is evaluated for
every row, against the columns before it.

```axis
table {
    u = [-3, -2, -1, 0, 1, 2, 3]
    u ^ 2 @ color: PURPLE
    u ^ 3 @ color: RED, hidden
}
```

Only `header = [ … ]` splits into a header and cells. Anything else is taken as
a computed column exactly as written, so `x = 5` is an equation, which no
column can be:

```axis error="invalid-column"
table { x = [1, 2, 3]; x = 5 }
```

### Styling a table

Each column carries its own metadata, written after it the way a statement's
is. Metadata written straight after the table's `{` is a default for every
column, and a column's own metadata wins over it:

```axis
table { @ color: BLUE, lines, pointSize: 12
    x_1 = [1, 2, 3, 4]
    y_1 = [1, 3, 2, 5]
    y_2 = [2, 1, 4, 3] @ color: RED, lineStyle: DASHED
}
```

A column takes what a table's points and lines can use: `color`, `lineStyle`,
`lineWidth`, `lineOpacity`, `pointStyle`, `pointSize`, `movablePointSize`,
`pointOpacity`, `hidden`, `points`, `lines`, `dragMode`, and `use:` for a
style. Anything else - a `label`, a `fill` - is an error there, since Desmos
has nowhere on a column to put it.

`dragMode` on a column makes its points draggable, and dragging one changes
the cell it came from - a way to let whoever reads the graph move the data.

## Lists

A list is written in square brackets and is a single value. Arithmetic on it
applies to every element, a function of it gives back a list, and a list where
one number would go draws one curve per element:

```axis
N = [1, 2, 3, 4, 5, 6] @ hidden
(N, N ^ 2) @ color: RED, pointSize: 12
(N, 0.5N) @ color: GREEN, lines, points: false
K = [-2, -1, 0, 1, 2] @ hidden
y = x + K @ color: PURPLE, lineOpacity: 0.6
```

The same two lists written as a table would draw the same points. The
difference is what can be done with them: a table is data somebody can type
into, while a list can be worked out - from a range, a comprehension, or
another list.

### Building lists

```axis
R = [1...10]
odd = [1, 3...19]
S = [i ^ 2 for i = [1...10]]
both = join(R, S)
ordered = sort(both)
flat = repeat(3, 5)
```

`[1...10]` is every whole number from 1 to 10, and `[1, 3...19]` steps by the
gap between the first two. A `for` comprehension runs an expression over every
element of a list; with two bindings, `for i = A, j = B`, it runs over every
pair.

### Reading lists

`L[3]` is the third element, counting from 1. A list range inside the brackets
takes a slice, and a condition keeps just the elements that meet it:

```axis
L = [4, 1, 7, 3, 9]
third = L[3]
firstTwo = L[1...2]
big = L[L > 3]
n = length(L)
avg = L.mean
```

Any function of one list may be written after it as a member, so `L.mean` is
`mean(L)` and `L.count` is `count(L)`. The
[function reference](../../reference/functions/#statistics) lists the
statistics and [list functions](../../reference/functions/#lists) there are.

### Lists of points

Two lists paired in a point are a list of points, one per element; a list of
points written out is the same thing. `lines` joins them up in order, and
`polygon` takes one list of points to close into a shape:

```axis
S = [(-6, -2), (-2, -2), (-2, -6), (-6, -6)] @ hidden
polygon(S) @ color: RED, fill, fillOpacity: 0.35
T = [(1, 1), (3, 4), (5, 2)] @ color: BLUE, lines
```

A list of points clicked or dragged is still one statement; `index` says which
point of it was clicked (see [Interactivity](../interactivity/#which-one-was-clicked)).
