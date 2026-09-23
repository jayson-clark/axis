# @axis-dsl/language-server

The [Axis](https://github.com/jayson-clark/axis) language server: everything
`@axis-dsl/language-service` knows about a script, spoken over the Language
Server Protocol, plus the file-system work the service leaves to a host -
resolving and reading imports and images, listing a directory for a path
completion, and noticing when a file a script reads has changed.

The VSCode extension bundles it and talks to it over node IPC. Any other editor
starts the `axis-language-server` bin over stdio.

## What it does

| Feature                          | Notes                                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnostics                      | Pushed (`textDocument/publishDiagnostics`), debounced 250 ms after an edit. Everything a compile would report, with imports resolved; an import or image whose file is not there is reported as `Cannot find "…"` or `Cannot find image "…"` on its path. |
| Re-checking                      | A document is checked again when a file it imports or draws is created, changed, deleted or saved, or edited unsaved in another open buffer. The server registers the file watcher itself.                                                                |
| Completion                       | Keywords, properties in metadata, names (including those an import defines), and paths inside `import "…"` / `image "…"`, read off disk.                                                                                                                  |
| Hover                            | Keywords, builtins, and the names a script or its imports define.                                                                                                                                                                                         |
| Formatting                       | Whole document and range. The line length is `axis.format.maxLineLength` from the client's settings (100 when unset).                                                                                                                                     |
| Semantic tokens                  | Full and range, over the service's `SEMANTIC_TOKEN_LEGEND`.                                                                                                                                                                                               |
| Links                            | The path in an `import` or `image`, resolved to the file it names.                                                                                                                                                                                        |
| Definition                       | Within the file, and into the imported file that defines a name.                                                                                                                                                                                          |
| References, highlights           | Within the file.                                                                                                                                                                                                                                          |
| Document symbols, folding ranges |                                                                                                                                                                                                                                                           |

Open documents take precedence over disk: a script that imports a file you are
editing sees your unsaved changes.

Paths resolve the way the compiler's hosts resolve them: relative to the file
they are written in, with `.axis` implied on an import, and a leading `/`
relative to the workspace folder holding the file (or its own directory, outside
every workspace folder).

## Running it

```sh
npm install --global @axis-dsl/language-server
axis-language-server --stdio
```

From a checkout of this repository, `pnpm build` and then
`node packages/language-server/dist/bin.js --stdio`.

`--node-ipc` and `--socket=<port>` work too; `--stdio` is what editors other
than VSCode use.

### Settings

The server asks for the `axis` section with `workspace/configuration`:

```json
{ "axis": { "format": { "maxLineLength": 100 } } }
```

### Initialization options

| Option             | Meaning                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retriggerCommand` | A client command that reopens the completion list, attached to a directory completion so a path is completed a segment at a time. VSCode's is `editor.action.triggerSuggest`. Off when absent. |

## Editors

None of these editors knows Axis yet, so each snippet also declares the
language for `.axis` files.

### Neovim (0.11+)

```lua
vim.filetype.add({ extension = { axis = 'axis' } })

vim.lsp.config('axis', {
    cmd = { 'axis-language-server', '--stdio' },
    filetypes = { 'axis' },
    root_markers = { '.git' },
    settings = { axis = { format = { maxLineLength = 100 } } },
})
vim.lsp.enable('axis')
```

Semantic tokens colour the file with no Tree-sitter grammar; `:set
commentstring=//\ %s` makes `gc` comment a line.

### Helix

In `languages.toml`:

```toml
[language-server.axis-language-server]
command = "axis-language-server"
args = ["--stdio"]
config = { axis = { format = { maxLineLength = 100 } } }

[[language]]
name = "axis"
scope = "source.axis"
file-types = ["axis"]
roots = []
comment-token = "//"
indent = { tab-width = 4, unit = "    " }
language-servers = ["axis-language-server"]
```

Helix has no semantic highlighting, and there is no Tree-sitter grammar for
Axis, so the file is uncoloured; everything else works.

### Zed

Zed only starts a language server for a language an extension defines, so Axis
needs a small dev extension (`zed: install dev extension`), a Rust crate
depending on `zed_extension_api` with these three files. This sketch has not
been tried against a real Zed yet; Zed may insist on a Tree-sitter grammar for
the language.

```toml
# extension.toml
id = "axis"
name = "Axis"
version = "0.0.1"
schema_version = 1

[language_servers.axis-language-server]
name = "Axis"
languages = ["Axis"]
```

```toml
# languages/axis/config.toml
name = "Axis"
grammar = ""
path_suffixes = ["axis"]
line_comments = ["// "]
```

```rust
// src/lib.rs
use zed_extension_api::{self as zed, LanguageServerId, Result};

struct Axis;

impl zed::Extension for Axis {
    fn new() -> Self {
        Axis
    }

    fn language_server_command(
        &mut self,
        _id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        Ok(zed::Command {
            command: worktree
                .which("axis-language-server")
                .ok_or("axis-language-server is not on PATH")?,
            args: vec!["--stdio".into()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(Axis);
```

Settings go under `lsp` in Zed's `settings.json`:

```json
{ "lsp": { "axis-language-server": { "settings": { "axis": { "format": { "maxLineLength": 100 } } } } } }
```

## Using it as a library

```ts
import { startServer } from '@axis-dsl/language-server';

startServer(); // a connection from process.argv: --stdio, --node-ipc or --socket
```

`startServer(connection)` takes a `vscode-languageserver` connection of your
own - over a stream pair, say, in a test - and `listen(connection)` is the same
without the default. `AxisInitializationOptions` types what a client may send
at `initialize`.
