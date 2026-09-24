---
title: Imports and images
description: Building a graph out of several files, and putting pictures on it.
sidebar:
  order: 9
---

A file can bring in two things from outside itself: another file, with
`import`, and a picture, with `image`. Both name what they bring the same way,
and both are read before the compiler runs.

## Importing a file

`import` drops the whole of another file into this one, in a folder of its
own. It is the way to keep a long graph in several files, and to reuse one
across graphs.

```axis
import "./lib/waves"

y = sine(x) + cosine(x) @ color: PURPLE, lineWidth: 3
```

Everything the imported file defines is in scope - `sine` and `cosine` above
come from `lib/waves.axis` - and so are its macros and styles. Nothing about a
file makes it a library: `lib/waves.axis` is an ordinary file, which graphs
on its own when it is opened by itself.

### Paths

The path is relative to the file the import is written in, and a leading `/`
makes it relative to the workspace root instead. The `.axis` may be left off,
so `"./lib/waves"` and `"./lib/waves.axis"` name the same file. In the editor
the path completes as it is typed, a directory at a time, and ctrl-clicking it
opens the file.

### The folder it makes

The folder is named after the file - `waves` - unless `as` names it, and
metadata on the statement styles it like any other folder's. An import's folder
starts collapsed, since what is in it is written and read elsewhere;
`collapsed: false` opens it.

```axis
import "./lib/waves" as "Waves" @ collapsed: false

y = sine(x) @ color: RED, lineWidth: 3
```

An imported file is **flattened**. Whatever folders it organises itself with
are dropped, and everything they held joins the one folder the import makes;
that holds all the way down, so a file that imports a file that imports a
file still arrives as one flat folder. Desmos has one level of folders, and the
import has claimed it - which is also why an import written inside a folder
joins that folder rather than opening another:

```axis
import "./lib/waves"

folder "Envelope" {
    import "./lib/envelope"
    y = sine(x) * envelope(x) @ color: RED, lineWidth: 3
}
```

### What travels with it

- **Config.** An imported file's `config` applies too, with the importing
  file's settings winning wherever the two disagree.
- **The ticker.** The importing file's ticker replaces an imported one.
- **Macros and styles** are global across the compilation, so they reach every
  file, in both directions.

A file imported more than once is included the first time and is nothing the
other times, wherever the imports are - a second copy would define every name
in it again, which Desmos rejects. `lib/envelope.axis` imports `lib/decay.axis`
for that reason: a file may import both without the constant being defined
twice.

A file that imports itself, however indirectly, is an error
(`import-cycle`) rather than a hang. An import whose file cannot be read is
`unresolved-import`, and the rest of the file still compiles:

```axis error="unresolved-import"
import "./lib/missing"

y = x ^ 2
```

The preview watches everything a file imports, so saving any file the graph
is built from reloads it. A change made in the preview to something an import
brought in is not written back, since only the file the preview was opened
on is edited.

## Images

`image "…"` places a picture on the graph, styled the way everything else is.

```axis
w = 6 @ slider: 2..10
c = (-3, 2)

image "./images/wave.png" @ name: "Wave", center: c, width: w, height: w * 0.6
y = 2 * sin(x) @ color: BLUE, lineWidth: 3
```

Every measurement is an expression, so an image can be centred on a point the
graph works out and sized by a slider. `name` is the caption the expression
list shows; `center`, `width` and `height` place it; `angle` turns it,
anticlockwise, in radians; `opacity` fades it; and `foreground` draws it over
the graph rather than under it.

```axis
image "./images/wave.png" @{
    center: (3, -2)
    width: 5
    height: 3
    angle: pi / 12
    opacity: 0.4
    foreground
}
```

`hidden`, `secret`, `dragMode`, `onClick` and `clickable` mean what they do on
anything else. `dragMode` is the one difference: Desmos only keeps whether a
picture is draggable, so any mode but `NONE` makes it so.

### Files, URLs and data URIs

What an image names may be one of three things.

```
image "./photos/beach.jpg"             // a file, beside this one
image "https://example.com/beach.jpg"  // a URL, fetched by Desmos
image "data:image/png;base64,iVBOR…"   // the picture itself
```

A **file** is named the way an import names one: relative to the file naming it, or
from the workspace root with a leading `/`. It is read at compile time and
inlined into the graph as a `data:` URI. A path only means something on the
machine the file was written on, and a graph has to carry its pictures with
it, so the file travels with it.

A **URL** is left alone for Desmos to fetch when the graph opens, and a
**`data:` URI** is passed straight through - which is how Desmos itself stores a
picture somebody dropped onto a graph.

A file may be a png, jpg, gif, webp, svg, bmp, ico, apng or avif. Anything else
is an error (`invalid-image`) rather than a file a browser is left to guess at,
and a file that is not there is `unresolved-image`. The editor treats a picture
as it does an import: it completes the path, underlines one that is missing,
opens the file on a ctrl-click, and reloads the preview when it is saved.

### Pictures and write-back

Because a file is inlined before the graph exists, the graph never knows the
path. Dragging a picture in the preview is still a real edit, and is written
back - with the path taken from the statement it replaces, never from the
graph, so the filename stays a filename. A picture added to the graph in
Desmos is not written back at all: it arrives carrying its own bytes, and the
file would gain the whole picture in base64.

Decompiling a graph has the same limit from the other side: an inlined picture
comes back as its `data:` URI (see [Decompiling](../decompiling/)).
