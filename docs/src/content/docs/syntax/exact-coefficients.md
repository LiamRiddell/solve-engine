---
title: "Exact coefficients"
description: Keeping the numbers in an expression as exact rationals rather than floating-point.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

The numbers in front of the terms of an expression, its coefficients, are kept as
exact fractions rather than the approximate floating-point numbers a computer
usually uses. This is why `0.1 + 0.2` comes out as exactly `0.3` here and not the
familiar `0.30000000000000004`. Like the other algebra forms, this reads with a
trailing arrow to show the simplified result.

Coefficients are exact rationals, not floating-point numbers. In ordinary
floating point `0.1 + 0.2` is `0.30000000000000004`; here it is not.

```solve
0.1x + 0.2x => // 0.3x
x/3 + x/3 =>   // 2/3x
```

A fraction that cannot be written as a short decimal stays a fraction rather
than being rounded into one.
