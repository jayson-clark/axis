# @axis-dsl/harness

Runs [Axis](https://github.com/jayson-clark/axis) source against a **real
Desmos calculator**, headless, so a test — or an agent — can read what Desmos
actually made of a script rather than what the compiler hoped it would.

```sh
npm install --save-dev @axis-dsl/harness
npx playwright-core install chromium
```

The compiler can only tell you what it emitted. Whether Desmos _accepts_ that —
whether an expression is graphable, whether `f(x)` resolves, what a definition
evaluates to, what `degreeMode` did to `sin(90)` — is knowable only by asking a
calculator, and a calculator only exists in a browser. So the harness puts one
in a headless Chromium and talks to it.

## Usage

```ts
import { createCalculator } from '@axis-dsl/harness';

const calculator = await createCalculator();

await calculator.load('f(x) = 2x + 1\ny = f(x)');

await calculator.getErrors(); // []
await calculator.evaluate('f(20)'); // { numericValue: 41, listValue: [] }

await calculator.close();
```

In a `node:test` suite, launch one calculator for the whole file — starting
Chromium is the expensive part, and every `load` replaces the graph:

```ts
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AxisCalculator, createCalculator } from '@axis-dsl/harness';

describe('my graph', () => {
    let calculator: AxisCalculator;
    before(async () => (calculator = await createCalculator()));
    after(() => calculator.close());

    test('is one Desmos accepts', async () => {
        await calculator.load('y = x^2');
        assert.deepEqual(await calculator.getErrors(), []);
    });

    test('evaluates as intended', async () => {
        await calculator.load('a = 6 * 7');
        const [expression] = await calculator.inspectExpressions();
        assert.deepEqual(expression.analysis?.evaluation, { type: 'Number', value: 42 });
    });
});
```

`withCalculator(fn)` is the one-off form: it opens a calculator, runs `fn`, and
closes it again.

## What you can ask it

|                                                     |                                                              |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `load(source, options?)`                            | compile Axis source and apply it, imports and all            |
| `setExpressions(list, settings?)`                   | apply expressions the compiler already produced              |
| `inspectExpressions()`                              | the expression list with each one's Desmos analysis attached |
| `getErrors()`                                       | just the expressions Desmos rejected, with its message       |
| `getAnalysis()`                                     | raw `calculator.expressionAnalysis`, keyed by id             |
| `getState()` / `getExpressions()` / `getSettings()` | the calculator's own accessors                               |
| `evaluate(latex)`                                   | evaluate an expression against the loaded graph              |
| `inspect()`                                         | all of the above in one object, which is what the CLI prints |
| `screenshot(options?)`                              | a PNG or SVG data URI of the graphpaper                      |
| `consoleErrors()`                                   | anything the page logged as an error                         |
| `page`                                              | the Playwright `Page`, for whatever this does not cover      |

`evaluate` takes **Axis**, not latex: `evaluate('amp')` asks about the variable
the script calls `amp`, where the raw latex `amp` would be three variables
multiplied together. `evaluateLatex` takes it verbatim.

`click` is how an `onClick` action gets tested — Desmos exposes no way to fire
one, so the harness moves a real mouse to where the object is drawn:

```ts
await calculator.load('a = 0 # sliderBounds: {min: 0, max: 5, step: 1}\n(1, 1) # onClick: a -> a + 1');
await calculator.click({ x: 1, y: 1 });
assert.equal((await calculator.evaluate('a')).numericValue, 1);
```

Every method that changes the graph waits for the calculator to go quiet before
it returns, because Desmos computes asynchronously: reading
`expressionAnalysis` the tick after a state is applied reads a graph that is
still thinking. A graph with a playing slider never goes quiet, so the wait is
capped by `maxSettleMs` and returns rather than throwing — its analysis is
stable long before its values are. `settle()` is exposed for a test that drives
the page itself.

## axis-inspect

The command an agent runs. It compiles a script, loads it into a real
calculator, and prints the verdict Desmos reached on every expression. It exits
`1` if any expression is in error, so it works in a check without anybody
parsing the output.

```sh
$ npx axis-inspect examples/scripts/01-basics.axis
01-basics.axis — 11 expressions, 0 errors

  0  text       Basics
  1  text       Notes explain a graph to whoever opens it next.
  2  graphable  y=2x+1
  3  ok         c=3 = 3
  …
```

```sh
axis-inspect <file.axis>              # a file, imports resolved from disk
axis-inspect -e 'y = x^2'             # source inline
axis-inspect - < graph.axis           # source on stdin
  --json                              # the whole inspection, machine-readable
  --errors-only                       # only what Desmos rejected
  --eval '<expr>'                     # also evaluate this against the graph
  --screenshot out.png                # write a PNG of the graphpaper
  --api-key <key>                     # default: the public demo key
  --offline                           # fail rather than fetch from desmos.com
```

## What the suites here check

`packages/harness/test` is the Axis language checked against the calculator that
has to accept it, rather than against the compiler's own idea of itself:

| Suite      | What it pins                                                                        |
| ---------- | ----------------------------------------------------------------------------------- |
| `metadata` | every one of the 24 `# key: value` properties, read back off the applied graph      |
| `config`   | every one of the 81 `config { … }` properties, read back off `calculator.settings`  |
| `language` | every function and constant in the manifest is one Desmos knows, plus the operators |
| `graph`    | folders, tables, notes, imports, and all 20 example scripts                         |
| `harness`  | the harness itself                                                                  |

Each of the first three is driven from `@axis-dsl/language`'s manifest and fails
if a name is added there without a test, so the coverage cannot quietly rot.
They caught three real bugs when they were written: `sliderBounds` never
reaching the calculator, `3cos(t)` compiling to three variables multiplied
together, and a double inequality in an example that Desmos will not shade.

## The calculator it runs

Desmos ships no offline calculator, so the harness serves the real
`calculator.js` — but only once. Every response the page pulls from desmos.com
is written to disk the first time and served from there afterwards, so a warm
run needs no network at all and `--offline` enforces it. The cache lives under
`$XDG_CACHE_HOME/axis-harness/<api-version>` (or `~/.cache/…`), keyed by API
version; `AXIS_HARNESS_CACHE` moves it, which is the directory to hand to CI's
cache step. It is about 4MB.

The page is served _from_ `https://www.desmos.com/axis-harness/` rather than a
loopback server. Nothing is actually fetched from there — every request is
answered out of the cache, and a request to any other host is aborted — but
sharing the origin means calculator.js resolves its own assets to URLs the same
interceptor recognizes, and no API key referrer rule has anything to object to.

Desmos' public demo key is the default, as it is elsewhere in Axis. Pass
`apiKey` (or `--api-key`) to use your own.

## Options

```ts
await createCalculator({
    apiKey,        // default: the Desmos demo key
    settings,      // CalculatorOptions the calculator is constructed with
    viewport,      // initial math bounds; fixed rather than fitted, for stability
    offline,       // fail on a cache miss instead of fetching
    headless,      // false to watch the graph in a real window while debugging
    timeout,       // load timeout, default 30s
    quietMs,       // how long the graph must be still to count as settled
    maxSettleMs,   // how long to wait for that, for a graph that never stills
    launch,        // extra Chromium launch options
});
```

## License

MIT
