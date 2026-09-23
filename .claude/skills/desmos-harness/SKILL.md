---
name: desmos-harness
description: Checking what Desmos actually does with compiled Axis - running axis-inspect, writing a test in packages/harness/test, and the Desmos behaviours that have caused silent bugs. Use when touching anything that ends up in a graph, writing or debugging a harness test, or when a graph compiles clean but draws, evaluates or animates wrong.
---

# Asking a real calculator

**The compiler can only tell you what it emitted, not whether Desmos accepts
it.** That gap is where the bugs live, and it is invisible to any test that
stops at the compiler. Real ones found exactly there: sliders that compiled
perfectly and were then dropped on the floor by `setState`, `3cos(t)` compiling
to three variables multiplied together, `2^10` coming out 0, a ticker that ran
and changed nothing, and an inequality Desmos will not shade. Every one of them
looked fine in the compiler's own output.

So when you touch anything that ends up in a graph, run it on a calculator.
The harness needs Chromium, once: `pnpm test:browser`.

## From the command line

```sh
node packages/harness/dist/cli.js examples/graphs/06-sliders-and-animation.axis
```

```
06-sliders-and-animation.axis — 25 expressions, 0 diagnostics, 0 errors

  0  text       Sliders
  1  ok         a=1 = 1
  2  ok         b=0 = 0
  …
```

It exits `1` if the compiler reports an error or any expression is in error, so
it also works as a check.

```sh
axis-inspect <file.axis>          # a file, imports and images resolved from disk
axis-inspect -e 'y = x^2'         # source inline
axis-inspect - < graph.axis       # source on stdin
  --json                          # the whole inspection, machine-readable
  --errors-only                   # only what Desmos rejected
  --eval 'f(20)'                  # evaluate an Axis expression against the graph (repeatable)
  --screenshot out.png            # write a PNG of the graphpaper
  --offline                       # fail rather than fetch from desmos.com
```

`--json` is the one to reach for when you want to inspect structure: it carries
the full graph state, every expression's `expressionAnalysis`, the compiler's
diagnostics, and any console errors the page raised. `--screenshot` is the way
to see whether something that evaluates also _draws_.

## In a test

`packages/harness/test/support.mts` gives a suite one shared calculator, and
skips it when no Chromium is installed:

```ts
import { skip, useCalculator } from './support.mts';

describe('what I changed', { skip }, () => {
    const calculator = useCalculator();

    test('is a graph Desmos accepts', async () => {
        await calculator().load('f(x) = 2x + 1\ny = f(x)');

        assert.deepEqual(await calculator().getErrors(), []);
        assert.equal((await calculator().evaluate('f(20)')).numericValue, 41);
    });
});
```

`getErrors()`, `inspectExpressions()`, `getState()`, `getSettings()`,
`evaluate()`, `click({x, y})` and `screenshot()` are the useful ones -
[`packages/harness/README.md`](../../../packages/harness/README.md) has the rest.

## Which suite

Anything that needs no calculator goes in the package it is about, where it is
fast and runs without a browser. Anything about what Desmos _does_ with the
result goes in `packages/harness/test`:

| File                   | What it pins                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| `metadata.test.mts`    | every `@` property, placement by placement, read back off the applied graph  |
| `config.test.mts`      | every `config { … }` property, read back off `calculator.settings`           |
| `language.test.mts`    | every function and constant in the manifest, plus the operators              |
| `expressions.test.mts` | emitted latex, evaluated by Desmos and compared with the tree's own value    |
| `styles.test.mts`      | how `use:` combines styles, checked on the graph they style                  |
| `diagnostics.test.mts` | a file with a mistake in it: what is reported, and that the rest still draws |
| `graph.test.mts`       | folders, tables, notes, imports, images, and every example graph             |
| `ticker.test.mts`      | the `ticker` statement, and that a playing one actually ticks                |
| `macros.test.mts`      | what a `macro` expands to, evaluated rather than just compiled               |
| `decompile.test.mts`   | decompiling the graph state a real calculator hands back                     |
| `writeback.test.mts`   | changes made to a live graph, written back into the file                     |
| `docs.test.mts`        | every manifest example and every `axis` block in the docs, drawn cleanly     |
| `harness.test.mts`     | the harness itself                                                           |

`metadata`, `config` and `language` are driven from the manifest in
`@axis-dsl/syntax`, and have guard tests that fail when a name appears there
with nothing exercising it. The metadata guard walks each placement's
`propertiesFor`, so a property newly allowed on a column or an image needs a
case there even when it is already tested on an expression - the same property
reaches a different part of the graph in each place.

## What Desmos does that you would not guess

None of these is an error on Desmos' side. Each is silence, which is why the
harness exists.

- **`setState` and `setExpression` take different shapes.** Everything here
  applies expressions with `setState`, because folder membership only travels
  that way - so the compiler emits the _graph state_ form. `slider`, not
  `sliderBounds`; `clickableInfo`, not `onClick`. A property in the wrong form
  is dropped, not reported.
- **An unknown function name is a product of variables.**
  `n_{otAFunction}\left(x\right)` is accepted and never evaluated. The checker
  reports `unknown-function` so an author hears about it, but in a harness test
  assert on `analysis.evaluation` or `isGraphable`, not just on `getErrors()`
  being empty.
- **An equation that is never true draws nothing.** `\pi=3` is simply false -
  which is why assigning to `pi`, `tau`, `e` or `infinity` is
  `assign-to-builtin` rather than left to Desmos.
- **Desmos normalises what you give it.** It leaves a property off the state
  when it matches its own default - a slider bound, a colour, a line width -
  and writes a switched-off clickable by omitting `enabled` rather than storing
  `false`. Assert against what it actually returns.
- **Its defaults are not the ones you would guess.** A list of points draws
  only the points unless it says `lines`; a parametric curve given no `domain`
  runs `t` over [0, 1], not a whole period; and a stepped slider snaps its
  value to the step's grid, counted from its `min`, so `a = 1` with a step of
  0.3 from -3 starts at 0.9.
- **A config option can gate another.** `logScales: false` forces
  `xAxisScale` back to linear, so config properties are tested one at a time
  rather than in one big block.
- **`actions: auto` cannot see a ticker.** Desmos decides `auto` from the
  expression list, and the ticker is not in it - so a graph whose only action is
  its ticker would never tick. The compiler sets `actions: true` for a file
  with a ticker for that reason.
- **The newer point styles are stashed.** A calculator hands a v1.12 point
  style back under `__stashed_V12PointStyle` rather than `pointStyle`, and
  without `doNotMigrateMovablePointStyle: true` on the state it substitutes its
  own style for any point it decides is movable. The compiler sets the flag;
  the decompiler reads the stash.
- **An image is `draggable`, not `dragMode`.** Desmos ignores `dragMode` on an
  image and keeps a boolean. The compiler lowers any mode but `NONE` to
  `draggable: true`, and the decompiler reads it back as `dragMode: XY`.
- **`evaluate` takes Axis, not latex.** `evaluate('amp')` asks about the
  variable the file calls `amp`; the raw latex `amp` is three variables
  multiplied. `evaluateLatex` takes latex verbatim.
