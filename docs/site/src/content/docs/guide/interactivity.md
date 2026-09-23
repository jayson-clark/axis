---
title: Interactivity
description: Dragging points, click actions, runs of actions, and clickable.
sidebar:
  order: 5
---

A graph can be handled as well as looked at. Points can be dragged, and
anything drawn - a point, a polygon, an image - can run an action when it is
clicked.

## Dragging

`dragMode` says how a point may be moved: `XY` anywhere, `X` or `Y` along one
axis only, and `NONE` not at all. Left out it is `AUTO`, which leaves it to
Desmos - broadly, a point it can move by changing a slider is draggable, and
one it cannot is not. Saying which is clearer than relying on the guess.

```axis
A = (-4, 3) @ color: RED, pointSize: 18, dragMode: XY, label: "free", showLabel
B = (0, 3) @ color: BLUE, pointSize: 18, dragMode: X, label: "x only", showLabel
C = (4, 3) @ color: GREEN, pointSize: 18, dragMode: Y, label: "y only", showLabel
D = (0, 0) @ color: PURPLE, pointSize: 18, dragMode: NONE, label: "pinned", showLabel
```

Anything else in the graph that reads a point follows it as it is dragged:

```axis
P = (3, -2) @ color: BLUE, pointSize: 15, dragMode: XY
(P.x, 0) @ color: BLUE, pointStyle: OPEN
(0, P.y) @ color: BLUE, pointStyle: OPEN
Q = [(0, 0), P] @ color: BLUE, lines, points: false, lineStyle: DASHED
```

On an image, `dragMode` is a switch rather than a direction: Desmos only keeps
whether a picture is draggable, so any mode but `NONE` makes it so.

In the VSCode preview and the playground, dragging a point is also an edit:
the statement that drew it is rewritten in the script with the point's new
coordinates.

## Actions

An action is `target -> new value`. On its own in a script it does nothing;
given to `onClick`, it runs when the object is clicked.

```axis
n = 0 @ slider: 0..10 step 1
(n, -2) @ color: ORANGE, pointSize: 20, onClick: n -> n + 1, description: "Increase n by one"
(0, -3) @ color: RED, pointSize: 20, onClick: n -> 0, description: "Reset n"
```

The target is a variable the script defines, and setting it is how anything
else moves: a point defined as a variable jumps to wherever the action sends
it. `description` is what a screen reader announces for a clickable object.

Any drawn statement can be clicked, not only a point:

```axis
n = 0
polygon((-2, -1), (2, -1), (2, -3), (-2, -3)) @{
    color: BLUE
    fill
    fillOpacity: 0.3
    onClick: n -> n + 2
    description: "Add two to n"
}
(0, n / 4) @ color: BLUE, pointSize: 14
```

## Runs

Several actions separated by commas are a **run**, and happen together on one
click. Given a name, a run can be used anywhere an action can - on as many
objects as need it.

```axis
n = 0
E = (2, -6) @ color: GREEN, pointSize: 18, dragMode: XY
reset = E -> (2, -6), n -> 0
(5, -6) @ color: RED, pointSize: 14, onClick: reset, description: "Reset E and n"
(5, -4) @ color: ORANGE, pointSize: 14, onClick: n -> n + 1, E -> E + (0, 1)
```

The last line shows how a run sits among other properties. Inside an inline
`@ …`, a comma starts a new property only when a property name and a colon (or
a bare flag) follow it; otherwise the comma belongs to the run. So
`onClick: a -> 1, b -> 2, color: RED` is a two-action run and then a colour.
Where that reads awkwardly, an `@{ … }` block puts each property on its own
line and the question does not arise.

A run can also be named from other runs: `R = A, B`, where `A` and `B` are
themselves actions, is a run of both.

## Which one was clicked

A list of points is one statement, so one `onClick` serves every point in it.
`index` inside the action is which one was clicked, counting from 1:

```axis
chosen = 0
P = [(1, 1), (2, 2), (3, 3)] @ onClick: chosen -> index, pointSize: 20
P[chosen] @ color: RED, pointStyle: OPEN, pointSize: 32
```

## Switching an action off

`clickable: false` keeps the action but disables it, the same as unticking the
box in Desmos - an action set aside rather than deleted, to be switched back
on from the expression list.

```axis
n = 0
(6, 2) @ color: PURPLE, pointSize: 18, onClick: n -> 99, clickable: false
```

## Actions and the ticker

A click runs an action once. The [ticker](../sliders-and-animation/#the-ticker)
runs one over and over on its own, with no click at all, and takes the same
actions and runs.

Desmos only allows actions when its `actions` setting says so. Left at `auto`,
it decides from the expression list, which is right for a graph with an
`onClick` in it; `config { actions: true }` says so outright.
