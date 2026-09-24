---
title: Styling
description: Metadata, colours, lines, points, fills and labels, and styles to reuse them.
sidebar:
  order: 3
---

Everything about how a statement looks is metadata, written after an `@` on
the statement it styles. Anything left out keeps Desmos' own default, so a
statement only names what it changes.

## Writing metadata

Inline, properties follow the `@` separated by commas. When there are more than
sit comfortably on the line, `@{ … }` holds the same properties one to a line,
and inside it the newline is the separator:

```axis
y = x ^ 3 @ color: BLUE, lineWidth: 4, lineOpacity: 0.6
y = x ^ 4 @{
    color: GREEN
    lineWidth: 4
    lineStyle: DASHED
}
```

A property that is true or false may be written bare, and a bare one means
`true`: `@ hidden, fill` is `@ hidden: true, fill: true`. `false` has to be
written out, as in `points: false`.

Values that are one of a fixed set - `DASHED`, `OPEN`, `above` - are not
case-sensitive, so `lineStyle: dashed` is fine. Each property takes one kind
of value and the checker holds it to that, so `lineWidth: "thick"` is an error
rather than something Desmos quietly ignores. The
[property reference](../../reference/properties/) says what each one takes and
where it may be written.

## Colour

`color` takes one of three things.

- A **hex literal**, `#c74440` or the short `#c44`.
- One of the Desmos palette's colours **by name**: `RED`, `BLUE`, `GREEN`,
  `PURPLE`, `ORANGE` or `BLACK`.
- **Any other expression** that works a colour out: `rgb(255, 128, 0)`,
  `hsv(h, 1, 1)`, or a variable holding one.

```axis
y = 3 @ color: #2d70b3, lineWidth: 6
y = 2 @ color: ORANGE, lineWidth: 6
warm = rgb(230, 120, 40)
y = 1 @ color: warm, lineWidth: 6
hue = 200 @ slider: 0..360 step 1
y = 0 @ color: hsv(hue, 0.8, 0.9), lineWidth: 6
K = [0...9]
(K - 4.5, -1) @ color: hsv(36K, 1, 1), pointSize: 16
```

A colour worked out by an expression moves with whatever it depends on - drag
`hue` and the line changes colour - and a list of colours gives each point of a
list its own. Left out altogether, Desmos gives each statement the next colour
of its palette in turn.

Palette names, unlike enum values, **are** case-sensitive. That is because
any other spelling is already an expression: `red` is the product r·e·d, which
Desmos would accept and draw in no colour you meant. So a palette name in the
wrong case is an error, unless the file defines a variable of that name
itself:

```axis error="invalid-color"
y = x @ color: red
```

The [palette](../../reference/properties/#the-palette) lists the six with their
hex values. The `config` colours - `backgroundColor`, `textColor`,
`accentColor` - take only a hex literal or a palette name, since Desmos wants a
fixed colour there.

## Lines

`lineStyle` is `SOLID`, `DASHED` or `DOTTED`; `lineWidth` is a thickness in
pixels, and `lineOpacity` fades the line from 1 down to 0.

```axis
y = x + 4 @ color: RED, lineStyle: SOLID, lineWidth: 5
y = x + 2 @ color: BLUE, lineStyle: DASHED, lineWidth: 3
y = x @ color: GREEN, lineStyle: DOTTED, lineWidth: 3
y = x - 2 @ color: PURPLE, lineWidth: 8, lineOpacity: 0.35
```

`lineWidth` and the opacities take any expression, so they can follow a slider
like everything else.

## Points

`pointStyle` is `POINT`, `OPEN`, `CROSS`, `SQUARE`, `PLUS`, `TRIANGLE`,
`DIAMOND` or `STAR`; `pointSize` is its diameter in pixels, and `pointOpacity`
fades it.

```axis
(-4, 0) @ color: RED, pointStyle: POINT, pointSize: 20
(-2, 0) @ color: BLUE, pointStyle: OPEN, pointSize: 20
(0, 0) @ color: GREEN, pointStyle: CROSS, pointSize: 20
(2, 0) @ color: ORANGE, pointStyle: STAR, pointSize: 20
(4, 0) @ color: PURPLE, pointSize: 30, pointOpacity: 0.3
```

A list of points draws only the points unless it says `lines`, which joins them
up in order; `points: false` then leaves only the path.

```axis
A = [(-5, 2), (-3, 3), (-1, 2), (1, 3)] @ color: ORANGE
B = [(-5, 0), (-3, 1), (-1, 0), (1, 1)] @ color: BLUE, lines
C = [(-5, -2), (-3, -1), (-1, -2), (1, -1)] @ color: GREEN, lines, points: false
```

## Fills

An inequality shades itself, and `fillOpacity` says how strongly. A closed
parametric curve or a polygon is shaded when it says `fill`; `lines: false`
keeps the shading and drops the outline.

```axis
x ^ 2 + y ^ 2 <= 4 @ color: GREEN, fillOpacity: 0.3
(5 + 2cos(t), 2sin(t)) @ color: BLUE, fill, fillOpacity: 0.25, domain: 0..tau
polygon((-6, -1), (-3, -1), (-4, 2)) @ color: RED, fill, lines: false
```

## Labels

`label` is the text, and `showLabel` puts it on the graph. `labelOrientation`
places it around the point - `above`, `below`, `left`, `right`, `above_left`
and so on - `labelSize` scales it, and `labelAngle` turns it. `description` is
what a screen reader announces for it.

`interactiveLabel` keeps the label out of sight until the point is hovered or
clicked, and `editableLabelMode: MATH` or `TEXT` lets the viewer type a new
one into the graph. Under a value in the expression list,
`displayEvaluationAsFraction` shows it as a fraction.

```axis
(0, 0) @ color: BLACK, label: "Origin", showLabel
(3, 3) @ color: RED, label: "Above", showLabel, labelOrientation: above
(3, -3) @{
    color: BLUE
    label: "Bigger"
    showLabel
    labelSize: 2
    description: "A point with a larger label"
}
(-3, 3) @ label: "Tilted", showLabel, labelAngle: pi / 6
(-3, -3) @ label: "Hover me", showLabel, interactiveLabel
a = 1 / 3 @ displayEvaluationAsFraction
```

## Hiding things

`hidden` keeps a statement in the expression list but off the graph, still
defined and usable. `secret` hides it from the expression list as well, which
suits the working parts of a construction nobody needs to see.

```axis
k = 10 @ hidden
scale = 0.5 @ secret
y = k sin(scale * x)
```

## Styles

A look used more than once can be named with `style` and applied with `use:`,
as if its properties had been written there. A property written on the
statement itself wins over the style.

```axis
style guide { color: BLACK; lineOpacity: 0.3; lineStyle: DASHED }

x = 0 @ use: guide
y = 0 @ use: guide
y = 2 @ use: guide, lineStyle: SOLID
```

[Macros and styles](../macros-and-styles/) covers styles properly: styles
using styles, several in one clause, and which one wins.
