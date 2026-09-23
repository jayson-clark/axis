---
title: Introduction
description: What Axis is, and what a script looks like.
---

Axis is a scripting language that compiles to [Desmos](https://www.desmos.com)
graphs. A `.axis` file goes in; the expressions, folders, tables and settings a
graph is made of come out.

```axis
f(x) = x ^ 2 - 4x + 3 @ color: RED
a = 1 @ slider: 0..5 step 0.5
y = a sin(x) @ lineStyle: DASHED
```

Each line is a statement: a definition, an equation, a note, a folder. `@`
styles the statement it trails.
