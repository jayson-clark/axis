# @axis-dsl/desmos

The Desmos calculator API, typed: its TypeScript surface, its style enums, and
the script URL every host loads. Written for
[Axis](https://jayson-clark.github.io/axis/), useful to anything that drives
Desmos from TypeScript.

```sh
npm install @axis-dsl/desmos
```

Desmos ships no types, so these are hand-written against the
[API docs](https://www.desmos.com/api/v1.13/docs/index.html) for the version
every host loads, `DESMOS_API_VERSION`. Nothing is bundled or vendored — the
calculator itself is loaded at runtime from `desmos.com` with your API key.

## Usage

```ts
import {
  AXIS_DESMOS_API_KEY,
  desmosScriptUrl,
  type Calculator,
  type DesmosNamespace,
  type DesmosExpression,
} from '@axis-dsl/desmos';

const script = document.createElement('script');
script.src = desmosScriptUrl(AXIS_DESMOS_API_KEY);
script.onload = () => {
  const Desmos = (window as unknown as { Desmos: DesmosNamespace }).Desmos;
  const calculator: Calculator = Desmos.GraphingCalculator(element, { expressions: false });

  const expressions: DesmosExpression[] = [
    { id: 'f', type: 'expression', latex: 'y=x^2', color: '#c74440' },
  ];
  calculator.setExpressions(expressions);
};
```

Note which setter you are calling. Desmos has two shapes for an expression:
`setExpression` takes the API's, and `setState` takes the serialized graph
state's — and only the latter carries a folder. Axis applies everything with
`setState` for that reason. `Expression` types both, so the properties that
belong to just one are marked: `sliderBounds` and `playing` are the
API's, `slider`, `folderId` and `clickableInfo` are the state's. A property
given to the wrong setter is dropped rather than reported.

`AXIS_DESMOS_API_KEY` is the Axis project's own key, which the extension, the
playground, the docs site and the harness all default to. Anything you build and
ship yourself should use your own - get one at
[desmos.com/api](https://www.desmos.com/api).

## Not only types

The style enums and the API constants are real runtime values, which is why this
is a package rather than a `.d.ts`:

```ts
import { LineStyle, PointStyle, DESMOS_SCRIPT_ORIGIN } from '@axis-dsl/desmos';

const dashed = { id: 'g', type: 'expression', latex: 'y=x', lineStyle: LineStyle.DASHED };
```

`DESMOS_SCRIPT_ORIGIN` is the one a host that sandboxes the calculator has to
name in its Content-Security-Policy.

## API

| Export                                                                     |                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `DesmosNamespace`                                                          | The `window.Desmos` global installed by `calculator.js`                 |
| `Calculator` / `BasicCalculator`                                           | A calculator instance and its methods                                   |
| `CalculatorOptions` and the other option interfaces                        | What the constructors take                                              |
| `ExpressionState` (`Expression`, `Table`, `Note`, `Folder`, `GraphImage`)  | The five things a graph's expression list is made of                    |
| `TickerState`, `SliderState`, `ClickableInfo`, `TableColumn`, …            | The pieces of a graph state they carry                                  |
| `LineStyle`, `PointStyle`, `DragMode`, `LabelOrientation`, `AxisArrowMode` | The style enums, as runtime values                                      |
| `GraphState`, `MathBounds`, `ScreenshotOptions`, `HelperExpression`, …     | The rest of the runtime surface                                         |
| `DesmosProduct` / `stateProduct(state)` / `DESMOS_PRODUCT_CONSTRUCTORS`    | Which calculator a state belongs to, and the constructor that builds it |
| `desmosScriptUrl(apiKey)`                                                  | The `calculator.js` URL for a key                                       |
| `DESMOS_API_VERSION` / `DESMOS_SCRIPT_ORIGIN` / `DESMOS_DOCS_URL`          | The version these types are written against, and where it is served     |
| `AXIS_DESMOS_API_KEY`                                                      | The Axis project's key, every Axis host's default                       |

MIT
