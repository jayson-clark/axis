---
title: Decompiling
description: Reading a Desmos graph back into an Axis file.
sidebar:
  order: 10
---

The compiler turns a file into a graph. The decompiler runs the other way: it
takes a graph state - what the compiler hands a calculator, or what a
calculator hands back - and writes the file that builds it. It is how a
graph made by clicking at desmos.com becomes a file, and it is what the
preview's write-back is made of.

## Using it

The decompiler is `decompileAxis` in `@axis-dsl/compiler`:

```ts
import { decompileAxis } from '@axis-dsl/compiler';

const { source, diagnostics } = decompileAxis({
    state: calculator.getState(),
    options: calculator.settings,
});
```

`state` is the graph state, exactly as `getState` returns it. `options` - the
calculator's settings - may be left off, since a graph saved at desmos.com is
a state and nothing else. On desmos.com itself the calculator on the page is
`Calc` in the browser console, so `Calc.getState()` is the state of whatever
graph is open.

## What comes back

Given this state, a folder holding a slider and a curve, a note, a point and
one expression Axis has no way to write:

```json
{
    "version": 11,
    "includeFunctionParametersInRandomSeed": true,
    "graph": { "viewport": { "xmin": -5, "xmax": 5, "ymin": -5, "ymax": 5 }, "showGrid": false },
    "expressions": {
        "list": [
            { "type": "folder", "id": "1", "title": "Parabola", "collapsed": true },
            { "type": "expression", "id": "2", "folderId": "1", "latex": "a=2",
              "slider": { "hardMin": true, "hardMax": true, "min": "0", "max": "5", "step": "0.5" } },
            { "type": "expression", "id": "3", "folderId": "1", "latex": "y=a\\left(x-1\\right)^{2}",
              "color": "#c74440", "lineStyle": "DASHED" },
            { "type": "text", "id": "4", "text": "Drag P." },
            { "type": "expression", "id": "5", "latex": "P=\\left(1,2\\right)",
              "color": "#2d70b3", "dragMode": "XY", "label": "P", "showLabel": true },
            { "type": "expression", "id": "6", "latex": "y=\\sum_{n=0}^{3}x^{n}", "color": "#388c46" }
        ]
    }
}
```

the decompiler writes:

```axis
config {
    showGrid: false
    xmin: -5
    xmax: 5
    ymin: -5
    ymax: 5
}

folder "Parabola" { @ collapsed
    a = 2 @ slider: 0..5 step 0.5
    y = a(x - 1) ^ 2 @ color: RED, lineStyle: DASHED
}

"Drag P."
P = (1, 2) @ color: BLUE, dragMode: XY, label: "P", showLabel
y = sum(n = 0..3, x ^ n) @ color: GREEN
```

The statements are built as syntax trees and printed with the formatter's own
printer, so the source is laid out exactly as `format` would lay it out, and
parses without a word. Each Desmos property becomes the `@` metadata that sets
it: a palette hex is its name, a slider's bounds are a range, a `true` flag is
written bare. Folders become `folder` blocks, and the settings become the
`config` block at the top.

## The round trip

The contract is that decompiling loses nothing the compiler needs:

```
compileAxis(decompileAxis(compileAxis(s)).source)  ≡  compileAxis(s)
```

That holds for every example, and for the state a real calculator hands
back - which is not the object it was given. Desmos leaves a property off when
it matches its own default, writes a switched-off clickable by omitting it,
and normalises the latex; the decompiler reads all of that as the file that
would produce it.

It also leaves out what compiling would fill in again anyway: a viewport edge
of ±10, a setting equal to Axis' own default, a `movablePointSize` equal to
the `pointSize`, and the `actions: true` beside a ticker. So a decompiled
file is no longer than it needs to be.

A few things a calculator adds are read back as what they mean. Newer point
styles come back from a calculator stashed under `__stashed_V12PointStyle`,
and are written as the `pointStyle` they are. The settings it mirrors into the
graph are config. Its `randomSeed` is kept only for a graph that calls
`random` or `shuffle`, where it decides what the graph draws.

Random draws themselves are the one thing a round trip does not keep. Desmos
seeds each `random` and `shuffle` partly from the id of the expression it sits
in, and a compiled graph's ids are Axis's own, so a graph read back and
compiled again draws different numbers from the same seed: the same kind of
numbers, not the same ones.

## What a graph cannot say

Some of a file never reaches the graph, so it cannot come back:

- **Comments and blank lines** are gone.
- **Imports** come back as the folders they were flattened into.
- **Macros and styles** come back as what they expanded to: the graph holds
  the sine, not `WAVE(1, 0)`, and the colour, not `use: hot`.
- **A picture inlined from a file** comes back as its `data:` URI, since the
  graph never knew the path.

A definition with `with` bindings is written as the statement it is:
`gap = a - b with a = 2, b = 1`. A latex name that would otherwise read as a
keyword keeps its subscript apart - `f_{or}` is written `f_or` - so the source
still parses.

## What Axis cannot write

Some latex has no Axis spelling yet - a regression's `\sim`, say - and some
items have no statement. The decompiler never throws on them. It leaves the
expression out (or, if the trouble is in one property, only that property),
puts a `// unsupported: …` comment where it would have been, and reports a
warning whose span is that comment:

| Code                | What                                                           |
| ------------------- | -------------------------------------------------------------- |
| `unsupported-latex` | latex the expression tree has no node for                      |
| `unsupported-item`  | a list item Axis has no statement for, or an image with no URL |
| `unsupported-value` | a colour or enum value Axis cannot write, or a blank cell      |

So a decompiled file always compiles, and the warnings say exactly what it
is missing.

## Write-back

The preview's write-back is the decompiler working a statement at a time.
Decompiling the whole graph after every drag would throw away everything a
file has and a graph does not - the comments, the macros, the styles, the
imports - so instead `writeBackGraph` compares the graph before and after a
change, decompiles only the items that changed, and rewrites exactly the
characters of the statements that drew them. It merges the change onto what
the file said rather than taking the calculator's answer whole, so a slider
bound Desmos did not bother to hand back is not deleted from the file.

The [compiler's README](https://github.com/jayson-clark/axis/tree/main/packages/compiler#writing-a-changed-graph-back)
has the details: the source map that ties each item to its statement, and every
change write-back refuses and why.
