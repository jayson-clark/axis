---
title: Matrices
description: Writing a matrix row by row, taking one apart with an index, building one with a comprehension, and putting it to work on points.
sidebar:
  order: 9
---

A matrix is written as a list with a `;` in it. The `;` ends one row and
starts the next:

```axis
A = [
    1, 2;
    3, 4;
]
v = [5; 6]
w = A * v
```

That is the layout the formatter gives a matrix of several rows and columns
that a statement defines: a row to a line, the columns lined up. Written on
one line, `A = [1, 2; 3, 4]`, it is the same matrix.

A `;` before the closing `]` ends the last row without starting another, which
is what makes a single row a matrix rather than a list:

```axis
r = [1, 2, 3;]
L = [1, 2, 3]
```

`r` is a 1×3 matrix and `L` a list of three numbers. A column needs no
such thing, `[5; 6]`, since it has a `;` already.

A graph that uses a matrix has matrices switched on for it. The Desmos API
leaves them off unless asked, and Axis asks, so there is nothing to write in
`config`.

## Arithmetic

Matrices add, subtract and scale as you would expect, and multiply when their
dimensions agree. `A ^ T` is the transpose and `A ^ -1` the inverse:

```axis
A = [2, 1; 1, 3]
B = 2A - A
At = A ^ T
Ai = A ^ -1
I = A * Ai
```

A `T` in the exponent of a matrix is its transpose even in a graph that
defines a variable `T`, because that is how Desmos reads it. `transpose(A)` is
the same thing, spelt out.

Write `*` between a matrix and one that comes after it. A `[` straight after
anything indexes it, so `A [5; 6]` is an index into `A`, not a product.

## Functions

`det`, `trace`, `rank` and `rref` measure a matrix, and `rows` and `columns`
take it apart into a list:

```axis
A = [1, 2; 3, 4]
d = det(A)
t = trace(A)
n = rank(A)
first = rows(A)[1]
second = columns(A)[2]
```

`rref` solves a system of equations written as its augmented matrix. For
2x + y = 5 and x + 3y = 10, the last column of the result is the solution:

```axis
S = rref([2, 1, 5; 1, 3, 10])
```

The [function reference](../../reference/functions/#matrices) lists them.

## Indexing

An index into a matrix names the rows it wants, then a `;`, then the columns.
Either side can hold several, separated by commas or as a range, and a side
left empty means all of them:

```axis
M = [1, 2, 3; 4, 5, 6; 7, 8, 9]
a = M[2; 3]
top = M[1, 2;]
middle = M[; 2]
rest = M[2...; 1]
```

## Building one

A comprehension with a `;` between its bindings makes a matrix. The bindings
before the `;` run down the rows and those after it across the columns:

```axis
n = 4
I = [{i = j: 1, 0} for i = [1...n]; j = [1...n]]
```

It has to be written in the list's brackets. Outside a bracket a `;` ends the
statement, so `I = 1 for i = L; j = M` would be two statements.

A cell can be a matrix, which builds a block matrix. A cell can also be left
blank, as it is in a matrix made in Desmos with `#23`, and a blank cell is 0:

```axis
A = [1, 2; 3, 4]
B = [A, A;]
Z = [1, ; , 1]
```

## Transforming points

A 2×2 matrix times a point transforms the point. This one turns `P` through an
angle `s` about the origin:

```axis
s = 0.6 @ slider: 0..tau
R = [
    cos(s), -sin(s);
    sin(s),  cos(s);
]
P = (3, 1) @ color: BLUE
R P @ color: RED
```

Every row of a matrix needs as many cells as the first. Leave a cell blank
rather than leave it out:

```axis error="ragged-matrix"
A = [1, 2; 3]
```
