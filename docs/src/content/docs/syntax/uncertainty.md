---
title: "Uncertainty"
description: Carrying a measurement tolerance through arithmetic.
---

> **Package:** `UNCERTAINTY_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

An uncertainty is the give-or-take on a measurement: a reading of `12.3` that
could be off by `0.5` either way. Solve lets you attach that tolerance to a
number and carries it through the sums, so you do not have to track the error on
a second line.

A measurement can carry a tolerance, written `±` or the ASCII `+/-`, and the
tolerance travels through the arithmetic so you do not have to track it on a
second line. `12.3 ± 0.5` is the number 12.3 with a one-sigma uncertainty of
0.5.

```solve
12.3 +/- 0.5 // 12.3 ± 0.5
(12.3 +/- 0.5) * 4 // 49.2 ± 2.0
(10 +/- 1) + (20 +/- 2) // 30 ± 2.24
(100 +/- 5) + 10% // 110 ± 5.5
```

`+`, `-`, `*` and `/` propagate it, combining independent errors in quadrature:
a sum or difference adds the spreads as `sqrt(a² + b²)`, and a product or
quotient adds the relative spreads the same way. A plain number counts as an
exact value, so multiplying by one scales the spread; a percentage is a scalar
multiply too, so `(100 ± 5) + 10%` is `110 ± 5.5`. The `±` binds tighter than
`+ - * /`, so `12.3 ± 0.5 * 4` is `(12.3 ± 0.5) * 4`; parenthesise to group
otherwise.

Everything else reads the centre and drops the tolerance: a comparison compares
the centres, and `sqrt`, `sin` and the like work on the centre alone. Correlated
errors, and a tolerance on a value with a unit, are out of scope.
