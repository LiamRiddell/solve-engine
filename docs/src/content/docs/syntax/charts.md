---
title: Charts
description: Turn a series or a function into a chart the engine describes as data.
---

> **Package:** `CHART_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

The engine never draws. A chart result is a **specification**, the points to
draw, the axes' extents, and a plain-text label, that **your application hands to
its own charting library**. The examples below are real results; the notepad on
this page draws them with a deliberately tiny built-in renderer, purely so the
docs can demo the shape. In your own app, you bring the charting library.

Both forms below produce one value type, `Chart`, with a `kind` that says how to
render it, so a host writes one switch and gets every chart the engine can
produce, today and later.

## Sparklines

`<vector> as sparkline` turns a numeric vector or a range into a sparkline: the
same numbers, drawn as a shape.

```solve
[120, 135, 128, 150, 162] as sparkline // [120, 135, 128, 150, 162]
map(x^2, 0:5) as sparkline // [0, 1, 4, 9, 16, 25]
```

Only a purely numeric vector (a single row or column) or a range can become a
sparkline; anything else is a clear error rather than an empty chart. The text
answer keeps the numbers, so a reader with no canvas still sees them. The series
is downsampled to at most 32 points, so a wide range costs nothing to draw.

## Function plots

`plot <expr> from <a> to <b>` samples an expression across a range and draws its
curve.

```solve
plot x^2 from -3 to 3 // x^2 over [-3, 3]
plot sin(x) from 0 to 2pi // sin(x) over [0, 6.28]
plot 1000 * 1.05^x from 0 to 10 // 1000 * 1.05^x over [0, 10]
plot 1/x from 0.5 to 5 // 1/x over [0.5, 5]
```

The variable is `x`, the same reserved name `map(x^2, 0:5)` binds, and the
expression is re-evaluated at each of 64 steps across the range, so the sample is
exact rather than interpolated. A step the expression cannot evaluate, `1/x` at
zero, is left as a gap in the curve rather than breaking the whole plot. `plot`
stays an ordinary word elsewhere, so `plot` remains usable as a variable name;
only `plot` followed by an expression begins a plot.

## The data, not the picture

A `Chart` value carries everything a renderer needs and nothing it does not: the
`kind` (`sparkline` or `plot`), the `(x, y)` `points`, the `domain` and `range`
they are scaled to, the source `expr` for a plot, and the `label` you have seen
in the answers above. It never carries pixels. This is the same split the colour
swatch and the matrix grid already use: the engine produces the numbers, the host
draws them. The chart package is on by default and removable, so an engine that
wants no charting drops it and these two forms simply stop parsing.
