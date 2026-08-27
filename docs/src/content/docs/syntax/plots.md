---
title: Plots
description: Sample an expression across a range and draw its curve.
---

> **Package:** `MAPREDUCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

`plot <expr> from <a> to <b>` samples an expression across a range and answers
with its points. In a notepad that can draw, the answer is a small line chart;
the text beside it names the expression and the range it covers.

```solve
plot x^2 from -3 to 3 // x^2 over [-3, 3]
plot sin(x) from 0 to 2pi // sin(x) over [0, 6.28]
plot 1000 * 1.05^x from 0 to 10 // 1000 * 1.05^x over [0, 10]
plot 1/x from 0.5 to 5 // 1/x over [0.5, 5]
```

The variable is `x`, the same reserved name `map(x^2, 0:5)` binds, and the
expression is re-evaluated at each step across the range, so the sample is exact
rather than interpolated. A step the expression cannot evaluate, `1/x` at zero,
is left as a gap in the curve rather than breaking the whole plot.

The engine emits only the `(x, y)` points, never a rendered image, exactly as a
colour emits its channels and a matrix its grid: a host that can draw renders
the curve, and one that cannot still shows the label. `plot` stays an ordinary
word elsewhere, so `plot` remains usable as a variable name; only `plot`
followed by an expression begins a plot.
