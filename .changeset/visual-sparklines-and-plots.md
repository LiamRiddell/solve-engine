---
"solve-engine": minor
---

Add inline sparklines and function plots (issues #186, #187).

A note could hold a series of numbers or the shape of a function, but not see
either. Both now answer with numeric metadata a frontend draws, never pixels,
exactly as a colour answers with its channels: the engine says what to draw, and
each host draws it.

## Sparklines

A numeric vector or a range answers with its numbers as always, and, in a
notepad that can draw, an inline sparkline of their shape beside them.

| expression | result |
| --- | --- |
| `[120, 135, 128, 150, 162]` | `[120, 135, 128, 150, 162]` (plus a sparkline) |
| `map(x^2, 0:5)` | `[0, 1, 4, 9, 16, 25]` (plus a sparkline) |

The text answer is unchanged; the sparkline is additive. The engine emits a
series downsampled to at most 32 points with the data's true minimum and
maximum, so a wide range costs nothing to plot. Only a purely numeric vector or
a range carries a series; a mixed or non-numeric list draws nothing.

## Function plots

`plot <expr> from <a> to <b>` samples an expression across a range and answers
with its points and a plain-text label.

| expression | result |
| --- | --- |
| `plot x^2 from -3 to 3` | `x^2 over [-3, 3]` |
| `plot sin(x) from 0 to 2pi` | `sin(x) over [0, 6.28]` |
| `plot 1/x from 0.5 to 5` | `1/x over [0.5, 5]` |

The variable is `x`, the same reserved name `map` binds, and the expression is
re-evaluated at each of 64 sample points, so the sample is exact rather than
interpolated. This re-entrant evaluation is built on the same machinery `map`
uses.

## The boundaries

- **Points, never pixels.** A plot is `(x, y)` points and a label, a sparkline a
  downsampled series and its extent; a host that can draw renders them, and one
  that cannot still shows the numbers. This is the split the colour swatch
  already uses.
- **A gap is not a failure.** A sample the expression cannot evaluate, `1/x` at
  zero, is left as a hole in the curve rather than breaking the whole plot.
- **`plot` stays an ordinary word.** It is claimed as syntax only when it starts
  a plot clause, so `:plot = 5` still defines a variable and `plot + 1` reads it.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
sparkline examples are proven on the vectors page, the plot labels on the new
plots page). New tests: `format/Sparkline.spec.ts` and
`packages/mapreduce/Plot.spec.ts`, both including the worker-DTO round-trip.
