# Example scripts

Read in order, each file assumes only what came before it.

| File                            | Covers                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `01-basics.axis`                | Statements, comments, notes, definitions, `#` metadata              |
| `02-functions.axis`             | Definitions, composition, the built-in function library             |
| `03-piecewise.axis`             | `{condition: value}` branches and domain restrictions               |
| `04-styling.axis`               | Colour, line and point styles, fills, opacity, labels               |
| `05-folders-and-notes.axis`     | Grouping a graph; `collapsed` folders                               |
| `06-sliders-and-animation.axis` | `sliderBounds`, `playing`                                           |
| `07-points-and-polygons.axis`   | Points, `polygon`, `distance`, `midpoint`, `.x` / `.y`              |
| `08-lists.axis`                 | List arithmetic, lists of points, one statement drawing many curves |
| `09-statistics.axis`            | `mean`, `stdev`, `var`, `mad`, `nCr`, `nPr`                         |
| `10-tables.axis`                | `table { … }`, per-column styling, computed columns                 |
| `11-parametric-and-polar.axis`  | Curves in `t`, equations in `r` and `theta`                         |
| `12-inequalities.axis`          | Shaded half-planes and regions                                      |
| `13-interactivity.axis`         | `dragMode`, `onClick` actions, `clickable`, `ticker`                |
| `14-colors.axis`                | The palette, named colours, opacity                                 |
| `15-config.axis`                | Every calculator setting worth knowing; `width` and `height`        |
| `16-imports.axis`               | `import "./file.axis"`, `as "Name"`, and how a file is flattened    |
| `17-macros.axis`                | `macro NAME body`, `macro NAME(a, b) body`, and what substitutes    |

The files under `lib/` are what `16-imports.axis` imports. They are ordinary
scripts — each one graphs on its own — that happen to be written to be reused.

## Showcases

| File                            | What it builds                                                         |
| ------------------------------- | ---------------------------------------------------------------------- |
| `showcase-unit-circle.axis`     | Sine and cosine read off a rotating radius, unrolled into a wave       |
| `showcase-bezier.axis`          | A cubic Bezier with draggable controls and de Casteljau's construction |
| `showcase-transformations.axis` | `a * f(b * (x - h)) + k`, one slider per word                          |
| `showcase-spirograph.axis`      | A hypotrochoid, with the rolling circle that draws it                  |
