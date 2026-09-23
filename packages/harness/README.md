# @axis-dsl/harness

Runs [Axis](https://jayson-clark.github.io/axis/) source against a **real
Desmos calculator**, headless, so a test — or an agent — can read what Desmos
actually made of a file rather than what the compiler hoped it would.

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

|                                                            |                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `load(source, options?)`                                   | compile Axis source and apply it; returns the `CompilationResult`, diagnostics and all           |
| `setGraph({ state, options })`                             | apply a whole graph, as the compiler returns it                                                  |
| `getGraph()`                                               | read it back the same way, as `writeBackGraph` compares it                                       |
| `setExpressions(list, settings?, graph?, state?, ticker?)` | apply expressions the compiler already produced, assembled into a state the way it assembles one |
| `inspectExpressions()`                                     | the expression list with each one's Desmos analysis attached                                     |
| `getErrors()`                                              | just the expressions Desmos rejected, with its message                                           |
| `getAnalysis()`                                            | raw `calculator.expressionAnalysis`, keyed by id                                                 |
| `getState()` / `getExpressions()` / `getSettings()`        | the calculator's own accessors                                                                   |
| `evaluate(expression)`                                     | evaluate an Axis expression against the loaded graph                                             |
| `evaluateLatex(latex)`                                     | the same, given latex that is already latex                                                      |
| `click({ x, y })`                                          | click the graph at a point in math coordinates                                                   |
| `updateSettings(options)` / `setMathBounds(bounds)`        | change the settings or the viewport of the loaded graph                                          |
| `reset()`                                                  | clear the graph back to empty                                                                    |
| `inspect()`                                                | all of the above in one object, which is what the CLI prints                                     |
| `screenshot(options?)`                                     | a PNG or SVG data URI of the graphpaper                                                          |
| `consoleErrors()`                                          | anything the page logged as an error                                                             |
| `page`                                                     | the Playwright `Page`, for whatever this does not cover                                          |

`load` applies source the compiler had something to say about all the same,
as every host does, and hands the diagnostics back rather than throwing: a test
that cares asserts on them itself.

`evaluate` takes **Axis**, not latex: `evaluate('amp')` asks about the variable
the file calls `amp`, where the raw latex `amp` would be three variables
multiplied together. `evaluateLatex` takes it verbatim.

`click` is how an `onClick` action gets tested — Desmos exposes no way to fire
one, so the harness moves a real mouse to where the object is drawn:

```ts
await calculator.load('a = 0 @ slider: 0..5 step 1\n(1, 1) @ onClick: a -> a + 1');
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

The command an agent runs. It compiles a file, loads it into a real
calculator, and prints the compiler's diagnostics beside the verdict Desmos
reached on every expression. It exits `1` if either found an error, so it works
in a check without anybody parsing the output.

```sh
$ npx axis-inspect examples/01-basics.axis
01-basics.axis — 14 expressions, 0 diagnostics, 0 errors

  0  text       Basics
  1  text       Notes explain a graph to whoever opens it next.
  2  graphable  y=2x+1
  3  ok         c=3 = 3
  …
```

```sh
axis-inspect <file.axis>              # a file, imports and images resolved from disk
axis-inspect -e 'y = x^2'             # source inline
axis-inspect - < graph.axis           # source on stdin
  --json                              # the whole inspection, machine-readable
  --errors-only                       # only what Desmos rejected
  --eval '<expr>'                     # also evaluate an Axis expression (repeatable)
  --screenshot out.png                # write a PNG of the graphpaper
  --api-key <key>                     # default: the Axis project's key
  --offline                           # fail rather than fetch from desmos.com
```

A file is read with its imports and images resolved from disk, relative to the
file, with a leading `/` relative to the file's own directory. The same
reading is exported for a test or a tool of your own: `readAxisFile(path)`
hands back `{ path, source, resolveImport, resolveImage }`, ready to spread into
`load` or `compileAxis`; `loadAxisSource(source, path)` does the same for source
already in hand, as though it were the file at `path`; and
`nodeImportHost`/`nodeImageHost` are the hosts both are built from.

```ts
import { createCalculator, readAxisFile } from '@axis-dsl/harness';

const { source, ...options } = await readAxisFile('examples/16-imports.axis');
const { diagnostics } = await calculator.load(source, options);
```

## The calculator it runs

Desmos ships no offline calculator, so the harness serves the real
`calculator.js` — but only once. Every response the page pulls from desmos.com
is written to disk the first time and served from there afterwards, so a warm
run needs no network at all and `--offline` enforces it. The cache lives under
`$XDG_CACHE_HOME/axis-harness/<api-version>` (or `~/.cache/…`), keyed by API
version; `AXIS_HARNESS_CACHE` moves it, which is the directory to hand to CI's
cache step, and `cacheDirectory()` says where it is. It is about 4MB.

The page is served _from_ `https://www.desmos.com/axis-harness/` rather than a
loopback server. Nothing is actually fetched from there — every request is
answered out of the cache, and a request to any other host is aborted — but
sharing the origin means calculator.js resolves its own assets to URLs the same
interceptor recognizes, and no API key referrer rule has anything to object to.

The Axis project's key is the default, as it is elsewhere in Axis. Pass `apiKey`
(or `--api-key`) to use your own.

## Options

```ts
await createCalculator({
    apiKey,        // default: the Axis project's key
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
