# Axis for VSCode

[Axis](https://github.com/jayson-clark/axis) is a scripting language that
compiles to Desmos graphs. This extension previews the `.axis` file you have
open as a live Desmos graph, and gives the language full editor support.

## Preview

Run **Axis: Preview Graph**, or press the graph button in the editor title bar.
The preview opens in a Simple Browser tab or your own browser - pin a choice to
stop being asked, or set `axis.previewTarget`. It reloads when you save the
script, or any file it imports or draws.

While the preview server is up there is an **Axis** item in the status bar, to
reopen a preview, serve another file, or stop the server.

## Language support

From the Axis language server, the same one other editors use:

- diagnostics as you type, including imports and images whose file is missing
- completion - keywords, properties in metadata, names, and paths
- hover, go to definition (into imported files too), find references, highlights
- formatting, of the document or a selection
- semantic highlighting, the outline, folding, and links on `import` and `image`
  paths

## Settings

| Setting                     | Meaning                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `axis.apiKey`               | Your Desmos API key. Blank uses Desmos' public demo key.    |
| `axis.previewTarget`        | `ask`, `editor` or `browser`.                               |
| `axis.preview.debug`        | Show the preview's Graph and JSON tabs and the file's path. |
| `axis.format.maxLineLength` | The column the formatter breaks a long line at. `0`: never. |

## Building

From the repository root, `pnpm install` and `pnpm build`. The extension is
bundled by `scripts/build.mjs` into `dist/`; `pnpm --filter axis-dsl package`
builds a `.vsix`.
