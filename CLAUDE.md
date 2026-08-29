# Working on Axis

Axis is a scripting language that compiles to Desmos graphs. `.axis` source in,
the expressions/folders/tables/settings a graph is made of out.

## Packages

| Package                | What lives there                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@axis-dsl/language`   | The manifest (functions, constants, metadata, config properties), grammar, completions, formatting, diagnostics |
| `@axis-dsl/compiler`   | `.axis` source → Desmos expressions and settings, the decompiler back the other way, and the latex converters   |
| `@axis-dsl/desmos`     | The Desmos calculator API, typed by hand                                                                        |
| `@axis-dsl/protocol`   | Messages and transports that drive the viewer                                                                   |
| `@axis-dsl/viewer`     | React components: the graph and the JSON inspector                                                              |
| `@axis-dsl/harness`    | Runs a script against a real headless Desmos calculator                                                         |
| `axis-dsl` (extension) | The VSCode extension                                                                                            |

## Commands

```sh
pnpm build          # build every package in dependency order
pnpm test           # build, then run every suite on node --test
pnpm typecheck      # everything, tests included
pnpm format         # prettier
pnpm test:browser   # download the Chromium the harness needs (once)
```

Tests run against each package's built `dist/`, so **build before testing** —
`pnpm test` does it for you.

## The harness — use it

**The compiler can only tell you what it emitted, not whether Desmos accepts
it.** That gap is where the bugs live, and it is invisible to any test that
stops at the compiler. Three real ones were found exactly there: sliders that
compiled perfectly and were then dropped on the floor by `setState`, `3cos(t)`
compiling to three variables multiplied together, and an inequality Desmos will
not shade. Every one of them looked fine in the compiler's own output.

So when you touch anything that ends up in a graph, **ask a real calculator**:

```sh
node packages/harness/dist/cli.js examples/scripts/06-sliders-and-animation.axis
```

```
06-sliders-and-animation.axis — 15 expressions, 0 errors

  0  text       Sliders
  1  ok         a=1 = 1
  2  ok         b=0 = 0
  …
```

It exits `1` if any expression is in error, so it also works as a check.

```sh
axis-inspect <file.axis>          # a file, imports resolved from disk
axis-inspect -e 'y = x^2'         # source inline
axis-inspect - < graph.axis       # source on stdin
  --json                          # the whole inspection, machine-readable
  --errors-only                   # only what Desmos rejected
  --eval 'f(20)'                  # evaluate an Axis expression against the graph
  --screenshot out.png            # write a PNG of the graphpaper
  --offline                       # fail rather than fetch from desmos.com
```

`--json` is the one to reach for when you want to inspect structure: it carries
the full graph state, every expression's `expressionAnalysis`, and any console
errors the page raised.

In a test, `packages/harness/test/support.mts` gives you a shared calculator:

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
`evaluate()`, `click({x, y})` and `screenshot()` are the useful ones — see
[`packages/harness/README.md`](./packages/harness/README.md) for the rest.

## Where a test goes

Compiler behaviour that needs no calculator — what latex a statement compiles
to, how a block parses — belongs in `packages/compiler/test` or
`packages/language/test`, which are fast and run without a browser. Anything
about what Desmos _does_ with the result goes in `packages/harness/test`:

| File                 | What it pins                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `metadata.test.mts`  | every `# key: value` property, read back off the applied graph     |
| `config.test.mts`    | every `config { … }` property, read back off `calculator.settings` |
| `language.test.mts`  | every function and constant in the manifest, plus the operators    |
| `graph.test.mts`     | folders, tables, notes, imports, and every example script          |
| `ticker.test.mts`    | the `ticker` statement, and that a playing one actually ticks      |
| `decompile.test.mts` | decompiling the graph state a real calculator hands back           |
| `harness.test.mts`   | the harness itself                                                 |

**Adding a name to the manifest means adding a test.** The first three suites
are driven from `@axis-dsl/language`'s manifest and have a guard test that fails
when a property or function appears there with nothing exercising it — that is
deliberate, and the fix is a test, not an exemption.

**Changing how something compiles means changing how it decompiles.** The
decompiler is the compiler's inverse and is tested as one: `decompile.test.mts`
in the compiler package holds `compile ∘ decompile ∘ compile ≡ compile` over
every example, so a new statement, property or latex rule needs the reading of
it as well as the writing — and the round trip will say so.

**Changing how something compiles means checking the examples.** They are the
widest use of the language there is, and `graph.test.mts` runs all twenty
through a calculator. `node packages/harness/dist/cli.js <file>` on the one you
touched is the quick version.

## Things that have caught people out

- **`setState` and `setExpression` take different shapes.** Everything here
  applies expressions with `setState`, because folder membership only travels
  that way — so the compiler emits the _graph state_ form. `slider`, not
  `sliderBounds`; `clickableInfo`, not `onClick`. A property in the wrong form
  is not an error, it is silence.
- **An unknown function name is not an error either.** `notAFunction(x)`
  compiles to the variable `n_{otAFunction}(x)`, which Desmos accepts happily
  and never evaluates. Assert on `analysis.evaluation` or `isGraphable`, not
  just on `getErrors()` being empty.
- **`evaluate` takes Axis, not latex.** `evaluate('amp')` asks about the
  variable the script calls `amp`; the raw latex `amp` is three variables
  multiplied. `evaluateLatex` takes it verbatim.
- **A config option can gate another.** `logScales: false` forces
  `xAxisScale` back to linear, so config properties are tested one at a time
  rather than in one big block.
- **`actions: auto` cannot see a ticker.** Desmos decides `auto` from the
  expression list, and the ticker is not in it - so a graph whose only action is
  its ticker gets actions switched off and simply never ticks. The compiler sets
  `actions: true` for a script with a ticker for that reason.
- **Desmos normalises what you give it.** It leaves a bound off the state when
  it matches its own default, and writes a switched-off clickable by omitting
  `enabled` rather than storing `false`. Assert against what it actually
  returns, which is what the harness is for.

## Style

Match the surrounding code. Comments explain _why_, in prose, and the existing
files are the reference for how much of it to write — see
`packages/compiler/src/compile.ts` or `packages/harness/src/page.ts`.
