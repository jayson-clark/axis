---
name: write-back
description: Working on the way back from a graph to Axis source - the decompiler (decompile.ts, latex/parse.ts), the source map, readback.ts and writeBackGraph - and the round-trip tests that hold them to the compiler. Use when a change made in the preview is written into the file wrong, when decompiled source does not compile back to the same graph, or when adding a statement or property the decompiler has to read.
---

# From a graph back to source

Two things go the other way from the compiler:

- **The decompiler** (`decompile.ts`, with `latex/parse.ts` reading Desmos'
  latex into a tree) turns a whole graph state into the file that builds it.
- **Write-back** (`readback.ts`, `writeback.ts`) turns a change made on a live
  calculator - a dragged point, a moved slider, a recoloured curve - into an
  edit to the statement that drew it, and leaves the rest of the file alone.

Both print through syntax's `print.ts`, so what they write is laid out exactly
as the formatter would lay it out.
[`packages/compiler/README.md`](../../../packages/compiler/README.md) describes
both from the outside: what is refused and why, and what each is careful about.

## The invariants

- **The decompiler is the compiler's inverse.** `decompile.test.mts` in the
  compiler holds `compile ∘ decompile ∘ compile ≡ compile` over every example,
  so anything new the compiler writes needs a reading here too, and the round
  trip will say when it is missing. The harness' `decompile.test.mts` holds the
  same over the state a real calculator hands back, which is not the object the
  compiler sent - see below.
- **The source map says where every item came from.** The compiler hands back a
  `sourceMap` from every item's id to the `span` of the statement that produced
  it, and `writeBackGraph` rewrites exactly those characters - so a new
  statement form has to record where it came from, or a change made to it in a
  graph lands in the wrong place. Spans are offsets rather than lines, so two
  statements sharing a line are rewritten independently.
  `packages/compiler/test/writeback.test.mts` notices when one is missing or
  wrong.
- **What cannot be written is reported, never thrown or guessed.** The
  decompiler leaves a comment and a warning; write-back puts the change in
  `skipped` with a reason.

## Things that have caught people out

- **Desmos normalises what you give it.** It leaves a property off the state
  when it matches its own default - a slider bound, a colour, a line width -
  writes a switched-off clickable by omitting `enabled` rather than storing
  `false`, and rewrites the latex. So a baseline has to be what a calculator
  _handed back_, not what it was sent.
- **A property missing from a state is not a property that was removed.** The
  same normalisation, from the other side: a slider given both its bounds comes
  back carrying only the `min`, because the `max` matched Desmos' own default.
  Anything writing a graph back to source has to merge the _change_ onto what
  the file said rather than take the calculator's answer whole, or dragging
  that slider deletes the top of `0..10` from somebody's file. `writeBackGraph`
  does; the harness test for it is the only thing that could have caught it.
- **A graph does not remember where its pictures came from.** `image
"./beach.png"` is resolved and inlined as a `data:` URI before the compiler
  runs, so nothing in the graph knows the path. Anything writing a graph back
  to source has to take the picture's name from the statement being replaced,
  or dragging a picture swaps its filename for the whole picture in base64.
- **A graph can move without anybody touching it.** A playing slider re-numbers
  itself several times a second and a running ticker changes whatever it drives.
  Anything that reacts to `change` has to tell that apart from an edit, or it
  fires forever - the write-back refuses both, by name.
- **A macro or a style leaves nothing behind.** They are resolved before
  lowering, so the round trip holds over a file full of them without the
  decompiler knowing either word. A statement a macro expanded into is marked
  unwritable in the source map, since writing the graph back over it would
  replace the call with its expansion.
- **The newer point styles are stashed** under `__stashed_V12PointStyle`, and
  an image keeps `draggable` rather than `dragMode`. The decompiler reads both
  back as the Axis property that set them.

## Testing

Pure transformations - latex in, tree out; a state in, source out; two
snapshots in, edits out - go in `packages/compiler/test`. Anything that needs
the state a real calculator hands back goes in the harness' `decompile.test.mts`
or `writeback.test.mts`, since that state is where the normalisation above
shows up. See the `desmos-harness` guide.
