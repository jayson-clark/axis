---
title: Expressions
description: Numbers, precedence, lists, piecewise, with and for, points, and when a call is a product.
sidebar:
  order: 2
---

An expression in Axis is written the way it would be typed into a calculator,
and compiled into the latex Desmos stores. Because it is parsed into a tree
first and written out from that, the latex carries exactly the brackets the
expression needs - precedence is decided by a table, never by how the text
happens to be spaced.

## Numbers and names

A number is `3`, `0.5` or `.5`, and may carry an exponent: `1e3` is 1000 and
`2.5e-2` is 0.025. Desmos has no scientific notation of its own, so the
compiler writes every number out in full. There is no negative literal: `-3`
is the operator `-` applied to `3`.

A name may be longer than one letter. Desmos only has single-letter names with
a subscript, so the compiler spells `amp` as `a_{mp}`, and `x_1` as `x_{1}`;
the file never has to. Greek letters and constants are written as words -
`pi`, `tau`, `theta`, `e`, `infinity` - and assigning to one of those is an
error rather than an equation Desmos would quietly find false.

```axis
amp = 2
theta0 = pi / 6
y = amp sin(x + theta0)
```

## Implicit multiplication

Two operands side by side with nothing between them are multiplied: `2x`,
`2pi x`, `3cos(t)`, `(a)(b)`, `x y`. It binds exactly as tightly as `*` and `/`,
and is read left to right with them.

```axis
t = 1
y = 3cos(t) x + 2pi
```

Between two 3D points, `*` is the dot product, and `cross(u, v)` the cross
product - Desmos' `\cdot` and `\times`:

```axis
u = (1, 2, 3)
v = (4, 5, 6)
n = cross(u, v)
d = u * v
```

An operand that starts with a sign is never juxtaposed, so `a -b` is a
subtraction, and a `[` straight after an operand indexes it rather than
multiplying it.

## Precedence

From loosest to tightest: comparisons, then `+` and `-`, then `*`, `/` and
juxtaposition, then a prefix `-`, then `^`, then calls, indexes, members and
`!`. Everything is left-associative except `^`. The consequences worth knowing:

```
1/2x     = (1/2)·x
a/b^2    = a/(b^2)
x^2/3    = (x^2)/3
a/b/c    = (a/b)/c
-x^2     = -(x^2)
2^-1     = 2^(-1)
2^3^2    = 2^(3^2)
```

`1/2x` is a half of `x`, not one over `2x` - write `1/(2x)` for that. `-x^2` is
always negative, as it is on paper, so `-3 ^ 2` is -9. The
[specification](../../spec/#51-precedence) has the full table.

## Points and members

A point is a pair in brackets. `.x` and `.y` read its coordinates, and any
function of one list may be written after a list the same way: `L.count`,
`L.mean`.

```axis
P = (3, -2) @ dragMode: XY
(P.x, 0)
(0, P.y)
L = [2, 4, 4, 5, 9]
m = L.mean
```

## Lists and ranges

A list is written in square brackets, and behaves as one value: arithmetic on
it applies element by element, and a list where a single number would go draws
one curve per element.

```axis
N = [1, 2, 3, 4, 5]
squares = N ^ 2
(N, squares) @ color: RED
K = [1...4]
y = x + K @ color: BLUE
odd = [1, 3...9]
third = odd[3]
```

`[1...10]` is every whole number from 1 to 10, and `[1, 3...9]` steps by the
gap between the first two. `L[3]` is the third element - Desmos counts from 1.
`..`, two dots, is something else: the range a slider or a domain takes, and
only ever a whole property value (see
[Sliders and animation](../sliders-and-animation/)).

## Piecewise

`{condition: value, condition: value, otherwise}` picks the first case whose
condition holds. A final entry with no condition is the fallback; without one,
the expression is undefined where nothing holds. Chained comparisons work
inside a case.

```axis
clamp(x) = {x < 0: 0, x > 1: 1, x}
pulse(x) = {-1 <= x <= 1: 1, 0}
y = x ^ 2 {0 < x < 3}
y = sin(x) {x > 0, x < 2pi}
```

Braces holding only conditions, straight after an expression, restrict its
domain: the curve is drawn only where every condition holds.

## with and for

`with` substitutes values into the expression before it, and `for` runs the
expression over every element of a list, building a new one. Both take a
comma-separated run of `name = value` bindings, which runs to the end of the
bracket or statement it is in.

```axis
f(x) = a x ^ 2 + b with a = 0.5, b = -2
S = [i ^ 2 for i = [1...10]]
G = [(i, j) for i = [1...4], j = [1, 2]]
```

Two bindings after `for` pair off every combination. In a statement the `=`
of a definition binds more loosely than anything else, so
`f(x) = x n with n = 3` defines `f` as `x n with n = 3`, rather than applying
`with` to the whole definition.

## Recursion

A function may call itself. Where it stops is a base case: a value for
particular arguments, which Desmos uses in place of the body. A base case can
follow a `with`, as many as it takes, or be a statement of its own - the two
read the same.

```axis
fib(n) = fib(n - 1) + fib(n - 2) with fib(0) = 0, fib(1) = 1
tri(n) = tri(n - 1) + n
tri(1) = 1
a = fib(10) + tri(10)
```

A case after a `with` has to be of a function the file defines; on anything
else it is `unknown-function`.

## Sums, integrals and derivatives

`sum`, `prod` and `int` name their variable once, with the range it runs over,
and then the body the variable is bound in. Either end of the range can be any
expression.

```axis
a = sum(n = 1..10, n ^ 2)
b = prod(k = 1..5, k)
y = int(t = 0..x, cos(t))
y = sum(k = 0..5, x ^ k / k!)
```

`d/dx` differentiates the product after it, the way Desmos does, so
`d/dx x ^ 2 + 1` is the derivative, then plus 1. Bracket a sum to differentiate
all of it. A prime differentiates a function, and `log` takes an optional base:

```axis
f(x) = x ^ 3
y = d/dx f(x)
y = d/dx (x ^ 2 + x)
y = f'(x) + f''(x)
z = log(8, 2)
```

A sum's variable has to be free where the sum stands. Desmos will not take a
name that is already a parameter or bound by a sum around it:

```axis error="rebound-variable"
f(k) = sum(k = 1..3, k)
```

## Calls and products

`name(…)` is a call when `name` is a function - a built-in one, or one the
file defines. Otherwise, with exactly one argument, it is a product:
`k(x - 1)` is `k` times `x - 1`, just as Desmos would read it.

```axis
k = 3
f(x) = x ^ 2
y = k(x - 1) + f(x)
```

A product needs a name Desmos reads as a value: a single letter, a variable the
file defines, a parameter, or a constant. A longer name that is none of
those is far more likely a misspelt function than a coefficient nobody
defined, so it is reported:

```axis error="unknown-function"
y = sine(x)
```

Desmos would not say so. It reads `sine(x)` as a product of variables, and at
most suggests defining one of them; nothing tells you the function is misspelt.
The
[function reference](../../reference/functions/) lists every function Axis
knows.

## Calling a member

A member can be called. `D.cdf(1)` is `cdf(D, 1)` written after the thing it
is about, which is how Desmos writes a distribution's methods and a test's, and
how it reads a list function with more arguments: `L.quantile(0.5)`.

```axis
D = normaldist(0, 1)
y = D.pdf(x)
p = D.cdf(-1, 1)
xs = [3, 1, 4, 1, 5]
q = xs.quantile(0.9)
```

A hypothesis test is read the same way: its members are its score, its
p-values, its degrees of freedom, and a confidence interval at a level.

```axis
before = [12, 15, 11, 14]
after = [14, 17, 13, 15]
T = ttest(before, after)
p = T.pleft
lo = T.conf(0.95).lower
```

## Complex numbers

`config { allowComplex: true }` puts the graph in complex mode. There `i` is
the imaginary unit, a complex number is drawn as the point it is on the plane,
and `real`, `imag`, `conj` and `arg` read it apart - as calls, or written after
it as members.

```axis
config { allowComplex: true }
z = 3 + 4i
w = conj(z)
a = z.real
m = arg(z)
```

Outside complex mode Desmos rejects those four, so the compiler reports them
before it does:

```axis error="requires-complex-mode"
a = real(3 + 4i)
```
