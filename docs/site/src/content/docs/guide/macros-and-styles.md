---
title: Macros and styles
description: Naming an expression with macro and a set of properties with style - both resolved away before Desmos sees the graph.
sidebar:
  order: 7
---

A file that repeats itself can name what it repeats. A `macro` names an
expression, and a `style` names a set of properties. Neither reaches Desmos:
both are resolved away when the file compiles, so the graph is the one you
would have written out by hand.

## Macros

A macro is an expression with a name. Without a parameter list it stands for
one expression and is used without brackets; with one, it takes arguments and
puts them into its body.

```axis
macro TAU = 6.283185
macro WAVE(k, phase) = sin(k * x + phase)

y = sin(TAU * x / 4) @ color: RED
y = WAVE(1, 0) + WAVE(2, TAU / 4) @ color: BLUE
```

Nothing named `TAU` or `WAVE` exists in that graph. Every use is replaced by
the body before anything is compiled, and the number and the sine are written
into each expression that used them.

### Expanded on the tree, not the text

The substitution is made on the parsed expression, not on its text, so an
argument keeps its own grouping without brackets: `WAVE(1 + 2, 0)` is
`sin((1 + 2) * x + 0)`, never `sin(1 + 2 * x + 0)`. The same goes for the
body, which is why `macro double(a) = 2 * a` used as `double(1 + 2) ^ 2` is
`(2 · (1 + 2))²`. A macro cannot capture a neighbouring operator, however it is
used.

```axis
macro double(a) = 2 * a

v = double(1 + 2) ^ 2
y = double(x - 1)
```

`v` is 36.

### A body can be a whole statement's value

A macro's body is read the way a statement's value is, so it may be a whole
equation, which then stands as a statement of its own, or an action run:

```axis
macro CIRCLE(radius) = x ^ 2 + y ^ 2 = radius ^ 2
macro reset = a -> 0, b -> 0

a = 1
b = 2
CIRCLE(1) @ color: BLACK, lineStyle: DASHED
CIRCLE(2) @ color: BLACK, lineOpacity: 0.3
(0, 0) @ onClick: reset, pointSize: 16
```

`dt` is allowed in a macro's body, since a macro may be written for a ticker.

### The rules

- **Macros are hoisted.** One is in scope for the whole compilation - above
  where it is written, and in every file it imports or is imported by.
  A file of nothing but macros is a library.
- **A macro shadows nothing.** Its name may not collide with a built-in, a
  function or variable the file defines, or another macro. One that does is
  reported and left out, so the name keeps its other meaning.
- **Arity must match.** A macro is used with exactly as many arguments as it
  has parameters, and one with no parameters is used without brackets.
- **No recursion**, direct or through another macro.
- **A macro only stands for an expression.** It cannot be a statement keyword,
  a block, or metadata - reusable metadata is what styles are for.
- **Macros belong at the top level.** Written inside a folder, one is an error.

A macro's body is checked once, where it is defined, with its parameters in
scope; a use is checked only for its arity. A diagnostic always points at text
the author wrote rather than at the expansion.

```axis error="macro-arity"
macro WAVE(k, phase) = sin(k * x + phase)

y = WAVE(1)
```

### Macros and the live preview

Because a macro is expanded and then forgotten, the graph holds the expansion,
not the call. So a statement a macro expanded into cannot be written back from
the preview: dragging something it drew would replace `WAVE(1, 0)` in the
file with the sine it stands for. The preview leaves such a statement alone
and says why.

## Styles

A style is a named set of properties, written like a `config` block, and
`use: name` in a statement's metadata applies it as if its properties had been
written there.

```axis
style guide { color: BLACK; lineOpacity: 0.3; lineStyle: DASHED }
style marker { pointSize: 16; showLabel; labelOrientation: above }

x = 0 @ use: guide
y = 0 @ use: guide
(2, 1) @ use: marker, color: RED, label: "P"
(-2, 1) @ use: marker, color: BLUE, label: "Q"
```

A style holds any property an expression or a table column may have - a
slider's range included - and is changed in one place for everything that uses
it.

### Composing styles

A style may use other styles and add to them, and one clause may use several.
They apply in the order written, so where two disagree the later wins; and a
property the clause writes itself beats every style it uses, wherever in the
clause it is written.

```axis
style marker { pointSize: 16; showLabel; labelOrientation: above }
style hot { use: marker; color: RED }
style cold { use: marker; color: BLUE }
style knob { slider: -3..3 step 0.1 }

(-3, 3) @ use: hot, label: "hot"
(-1, 3) @ use: hot, use: cold, label: "cold wins"
(1, 3) @ use: cold, use: hot, label: "hot wins"
(3, 3) @ color: GREEN, use: hot, label: "green"

a = 1 @ use: knob
y = a sin(x) @{
    use: cold
    lineWidth: 3
}
```

Like macros, styles are in scope everywhere - `hot` could as well be written
below the statements that use it - and across every file an import brings in.
Style names live in a namespace of their own, so a style and a variable may
share a name. A style that uses itself, however indirectly, is an error.

### Checked where it is used

A style is checked where it is defined, and again where it is used for what it
could not know there. A property it sets that the statement using it does not
take - `showLabel` from a style used on a table column, say - is reported
against the `use:`:

```axis error="misplaced-property"
style marker { pointSize: 16; showLabel }

table { x = [1, 2, 3]; y = [1, 4, 9] @ use: marker }
```

Unlike a macro, a style does not stop a statement being written back from the
preview. `use:` is source like any other property, so it stays where it is,
and a property changed in the graph is written on the statement as an override.

## Which to reach for

Macros make expressions and styles make metadata, and each is checked as what
it is. If what repeats is maths - a formula, a constant, a shape - it is a
macro. If it is how things look or behave - a colour and a line style, a
slider's range - it is a style.
