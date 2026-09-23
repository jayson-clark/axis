---
title: Introduction
description: What Axis is, why a graph might want to be a script, and what one looks like.
sidebar:
  order: 0
---

Axis is a scripting language that compiles to [Desmos](https://www.desmos.com)
graphs. A `.axis` file goes in; the expressions, folders, tables and settings a
graph is made of come out, ready for a calculator to draw.

```axis
"A parabola and a wave"

f(x) = x ^ 2 - 4x + 3 @ color: RED
a = 1 @ slider: 0..5 step 0.5
y = a sin(x) @ color: BLUE, lineStyle: DASHED
```

Each line is a statement: a note, a function, a slider, an equation. Anything
after an `@` is metadata - how the statement looks and behaves - so the colour,
the slider's range and the dashed line are written beside the thing they
belong to rather than set afterwards in a menu.

## Why write a graph

Desmos is built to be clicked. That is the right way to explore an idea and a
hard way to keep a large graph in order: a long expression list has no
comments, no way to reuse a piece of it in another graph, and no history but
the undo stack. Axis keeps the graph as text instead, which buys the things
text already has.

- **A graph is a file.** It can be diffed, reviewed, and kept in git beside
  whatever else it belongs to. A comment explains a line to whoever reads it
  next, and never reaches the graph.
- **Graphs can be built out of other graphs.** `import "./lib/waves"` drops a
  whole script into this one as a folder, so a long graph can live in several
  files and a useful one can be reused.
- **Repetition has names.** A `macro` names an expression and a `style` names
  a set of properties. Both are resolved away before Desmos sees anything, so
  the graph is the one you would have written out by hand.
- **Mistakes are reported, not drawn.** Desmos reads a misspelt `sine(x)` as a
  product of variables and `color: red` as r·e·d, and never calls either a
  mistake. Axis reports each as a diagnostic with a code and the place it was
  written.
- **The editor knows the language.** The VSCode extension completes, hovers,
  formats and checks as you type, and previews the graph beside the script.
  Drag a point or move a slider in the preview and the statement that drew it
  is rewritten in the editor.

Nothing about Desmos is hidden to make this work. Every statement becomes an
ordinary expression, folder, table or note, and a compiled graph is one
anybody can open, change and save at desmos.com. It also runs the other way:
the [decompiler](../../guide/decompiling/) reads a Desmos graph back into a
script.

## A slightly longer script

```axis
config { showGrid: true; xmin: -7; xmax: 7 }

style guide { color: BLACK; lineOpacity: 0.3; lineStyle: DASHED }

"Sine, and a point riding it"

folder "Controls" { @ collapsed
    amp = 2 @ slider: 0..4 step 0.1
    t = 0 @ slider: 0..2pi, playing
}

y = amp sin(x) @ color: BLUE, lineWidth: 3
(t, amp sin(t)) @ color: RED, pointSize: 16
y = amp @ use: guide
y = -amp @ use: guide
```

`config` sets the calculator up, `style` names a look to `use:` twice, the
folder keeps the sliders out of the way, and `playing` sets `t` moving the
moment the graph opens.

## Where to go next

- [Getting started](../installation/) installs the editor extension, the
  in-browser playground and the command-line harness.
- [The language](../../guide/the-language/) is a tour, statement by statement.
  The rest of the guide takes one topic at a time.
- The [reference](../../reference/) lists every function, property, setting
  and diagnostic, generated from the language itself.
- The [specification](../../spec/) is the contract the implementation is built
  against: where the two disagree, one of them is a bug.
