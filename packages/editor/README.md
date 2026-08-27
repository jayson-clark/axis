# @axis-dsl/editor

Monaco bound to the [Axis](https://github.com/jayson-clark/axis) language:
syntax highlighting, completions, formatting and diagnostics, in a dark and a
light theme.

```sh
npm install @axis-dsl/editor monaco-editor react
```

`monaco-editor` and `react` are peer dependencies.

## Usage

```tsx
import * as monaco from 'monaco-editor';
import { AxisEditor } from '@axis-dsl/editor';

<AxisEditor monaco={monaco} value={source} onChange={setSource} theme="dark" />
```

The Monaco namespace is a **prop**, not an import. Loading Monaco and wiring its
web workers is the one thing every bundler spells differently, so your app owns
it — and the editor then registers the Axis language on the same instance you
render, rather than a second copy of Monaco it pulled in itself.

With Vite:

```ts
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/edcore.main';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
export { monaco };
```

With webpack, use `monaco-editor-webpack-plugin`, or set
`MonacoEnvironment.getWorker` to whatever your bundler produces. Plain
`import * as monaco from 'monaco-editor'` works too — it just pulls in Monaco's
own languages, which Axis has no use for.

## API

| Export                                 |                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `AxisEditor`                           | The React component. Props: `monaco`, `value`, `onChange`, `theme?`, `options?`, `className?`, `style?`          |
| `AxisEditorHandle`                     | Ref handle: `format()`, `focus()`, `getEditor()`                                                                 |
| `setupAxis(monaco)`                    | Registers the language and themes. Idempotent per instance; only needed if you create Monaco editors of your own |
| `AXIS_DARK_THEME` / `AXIS_LIGHT_THEME` | The theme names `setupAxis` defines                                                                              |

`options` is merged over the defaults and re-applied when it changes. The editor
is created once and updated in place, so undo history and cursor position
survive re-renders.

MIT
