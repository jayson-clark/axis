---
title: Sliders and animation
description: Slider ranges, animating a slider, and the ticker.
sidebar:
  order: 4
---

A variable defined as a number is already a slider in Desmos. The `slider`
property gives it a range, and `playing` sets it moving. For anything a slider
cannot do - a count that steps once a second, a clock that keeps real time -
there is the `ticker`.

## Ranges

A slider's range is written `lo..hi`, with an optional `step` after it:

```axis
a = 1 @ slider: -5..5 step 0.5
b = 0 @ slider: -3..3 step 0.1
c = 1 @ slider: 0.5..4
y = a * (x - b) ^ 2 + c
```

`..`, two dots, is the range literal, and it is only ever a whole property
value. Three dots, `[1...10]`, are something else: a list.

Either end may be left off to keep Desmos' own default for it, so `0..` runs
from 0 up to Desmos' usual top of 10. Every end, and the step, may be any
expression, so one slider can set the reach of another:

```axis
p = 2 @ slider: 0.. step 1
lim = 3 @ slider: 1..6 step 1
s = 1 @ slider: -lim..lim step lim / 10
y = p + s * sin(x)
```

A stepped slider snaps its value to the step's grid, counted from its `min`,
not from zero. `a = 1 @ slider: -3..3 step 0.3` starts at 0.9, the nearest
point on that grid to 1.

### Soft ends

Both ends are **hard** by default: the slider stops there, and a value typed
into the expression list is held to them too. `soft` makes both ends soft - the
slider still spans the range, but a value typed in may go past it - and
`soft min` or `soft max` softens just the one. `step` comes before `soft` when
both are written.

```axis
q = 1 @ slider: -2..2 soft
k = 1 @ slider: 0..3 step 0.5 soft max
y = q sin(k x)
```

## Animating a slider

`playing` starts a slider moving the moment the graph opens. Three more
properties say how:

- `loopMode` is what it does at the end of its range: `LOOP_FORWARD_REVERSE`
  (the default) bounces back and forth, `LOOP_FORWARD` jumps back to the start,
  `PLAY_ONCE` stops, and `PLAY_INDEFINITELY` carries on past the end.
- `animationPeriod` is how long one sweep takes, in milliseconds. The default
  is 8000.
- `playDirection` is `1` to run forwards and `-1` to run backwards.

```axis
t = 0 @ slider: 0..2pi, playing, loopMode: LOOP_FORWARD, animationPeriod: 4000
(t, sin(t)) @ color: BLUE, pointSize: 18
y = sin(x) @ color: BLUE, lineOpacity: 0.4
```

`animationPeriod` and `playDirection` are plain numbers rather than
expressions, because Desmos keeps them as numbers.

## Curves drawn over a range

A parametric curve - a point written in terms of `t` - is drawn over the range
its `domain` gives, and a polar one over its `polarDomain`. Desmos' own default
runs `t` from 0 to 1, not over a whole period, so a curve that should close up
needs a domain:

```axis
(cos(t), sin(t)) @ color: RED, domain: 0..tau
(0.3t * cos(t), 0.3t * sin(t)) @ color: GREEN, domain: 0..6pi
```

A domain is its two ends and nothing else; `step` or `soft` on one is an error.
Like a slider's, either end may be an expression, so a slider can draw a curve
out as it moves.

## The ticker

A ticker runs one action over and over for as long as the graph is open. It is
how a graph animates something a slider cannot: a counter, a simulation, a
clock.

```axis
n = 0
clock = 0

ticker n -> mod(n + 1, 60), clock -> clock + dt @ minStep: 50, playing

(4cos(n * tau / 60), 4sin(n * tau / 60)) @ color: ORANGE, pointSize: 16
(2cos(clock * tau / 3000), 2sin(clock * tau / 3000)) @ color: PURPLE, pointSize: 12
```

The handler is an action, `target -> new value`, or a run of them separated by
commas, which happen together on each tick. Three properties go on it:

- `minStep` is the shortest gap between two ticks, in milliseconds. Left out,
  Desmos ticks once a frame.
- `playing` starts it when the graph opens. Without it the ticker is there but
  stopped, to be started from the expression list.
- `open` shows it expanded in Desmos' expression list.

### dt

Inside the handler, `dt` is the milliseconds since the last tick. It is not
always `minStep`, since a busy page ticks late, which is why `clock` above adds
up `dt` rather than counting ticks: it keeps real time however late they come,
and goes round once every three seconds whatever the frame rate. Divide by 1000
for seconds.

`dt` means nothing anywhere else, so written outside the handler it is an
error:

```axis error="dt-outside-ticker"
y = dt
```

It is always spelt `dt`. In Desmos' own latex it has to be the single operator
`\operatorname{dt}`; written any other way it would be d times t, and the
ticker would run and change nothing, silently. The compiler spells it for you.

### One per graph

A graph has exactly one ticker, and Desmos keeps it beside the expression list
rather than in it - so `ticker` goes at the top level, outside every folder,
and a second one is an error. An imported file's ticker is replaced by the
importing file's.

Desmos decides whether actions are allowed at all (the `actions` setting, left
at `auto`) by looking at the expression list, and the ticker is not in it. A
graph whose only action is its ticker would never tick, so Axis switches
`actions` on for any file with a ticker.
