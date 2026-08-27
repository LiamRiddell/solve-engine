---
"solve-engine": minor
---

Add charts: sparklines and function plots, emitted as data (issues #186, #187).

A note could hold a series of numbers or the shape of a function, but not see
either. Both now produce a `Chart` value: a specification a host draws with its
own charting library. The engine emits the points, the axes' extents and a
label, never pixels, the same split the colour swatch uses.

## One value type

`<vector> as sparkline` and `plot <expr> from <a> to <b>` both produce a single
`ValueType.Chart`, discriminated by a `kind`. A host reads `kind` to choose a
renderer and draws `points` scaled to `domain` × `range`; new chart kinds are
added without breaking a host that already switches on it.

## Sparklines

| expression | result |
| --- | --- |
| `[120, 135, 128, 150, 162] as sparkline` | `[120, 135, 128, 150, 162]` (a sparkline chart) |
| `map(x^2, 0:5) as sparkline` | `[0, 1, 4, 9, 16, 25]` (a sparkline chart) |

Only a purely numeric vector or a range can become a sparkline; anything else is
a clear error. The text answer keeps the numbers, so a reader with no canvas
still sees them, and the series is downsampled to at most 32 points.

## Function plots

| expression | result |
| --- | --- |
| `plot x^2 from -3 to 3` | `x^2 over [-3, 3]` |
| `plot sin(x) from 0 to 2pi` | `sin(x) over [0, 6.28]` |
| `plot 1/x from 0.5 to 5` | `1/x over [0.5, 5]` |

The variable is `x`, the same reserved name `map` binds, and the expression is
re-evaluated at each of 64 sample points, so the sample is exact. This re-entrant
evaluation is built on the same machinery `map` uses.

## The boundaries

- **Data, never pixels.** A `Chart` carries the `(x, y)` points, the domain and
  range they scale to, and a plain-text label; the developer brings the charting
  library that draws them.
- **Opt-out.** Charts are a new `solve-chart` package, on by default and
  removable: an engine that wants no charting drops it and the two forms stop
  parsing, exactly like the colour package.
- **A gap is not a failure.** A sample the expression cannot evaluate, `1/x` at
  zero, is left as a hole in the curve.
- **`plot` stays an ordinary word.** It is claimed as syntax only when it starts
  a plot clause, so `:plot = 5` still defines a variable and `plot + 1` reads it.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
sparkline and plot examples are proven on the new charts page). New tests:
`packages/chart/Chart.spec.ts`, including the worker-DTO round-trip and that the
package is removable.
