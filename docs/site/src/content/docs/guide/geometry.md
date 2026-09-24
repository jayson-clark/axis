---
title: Geometry
description: Constructions on the Desmos geometry calculator - segments, circles, intersections, transformations - and the tokens it names them with.
sidebar:
  order: 8
---

The Desmos geometry calculator draws constructions: a segment between two
points, the circle through a point, where two lines cross, a triangle turned
about a point. Axis writes them as functions, and a file asks for that
calculator in its config:

```axis
config { calculator: GEOMETRY }
A = (0, 0)
B = (4, 1)
C = (1, 3)
s = segment(A, B)
c = circle(A, B)
P = intersection(c, line(B, C))
```

A construction is a value like any other. It can be named, passed to another
construction, and measured - as a call, or as a member:

```axis
config { calculator: GEOMETRY }
A = (0, 0)
B = (4, 1)
C = (1, 3)
T = polygon(A, B, C)
a = area(T)
side = segment(A, B).length
rotate(T, A, pi / 2)
```

The [function reference](../../reference/functions/#geometry) lists every
one. They exist on the geometry calculator and nowhere else - `triangle` and
`sphere` only on the 3D one - so anywhere else the compiler says so before
Desmos does:

```axis error="requires-calculator"
s = segment((0, 0), (4, 1))
```

Their names are built in all the same, whichever calculator the file is for,
so `area`, `center` or `line` cannot be defined as names of your own.

## Tokens

A construction made by pointing and clicking on the geometry calculator has no
name the person gave it. Desmos names it itself, with a token, and Axis writes
a token as `$` and its number:

```axis
config { calculator: GEOMETRY }
$1 = (0, 0)
$2 = segment($1, (4, 1))
m = $2.length
```

A token is a name like any other, but Desmos keeps the definitions of tokens in
a hidden folder of the geometry calculator's own and accepts them nowhere else.
The compiler puts them there, wherever the file wrote them, so a graph made on
the calculator decompiles to a file that builds it again exactly. Written in a
file for any other calculator, a token is `requires-calculator`.
