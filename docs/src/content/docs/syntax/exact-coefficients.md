---
title: "Exact coefficients"
description: Keeping the numbers in an expression as exact rationals rather than floating-point.
---

> **Package:** `SYMBOLIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

The numbers in front of the terms of an expression, its coefficients, are kept as
exact fractions rather than the approximate floating-point numbers a computer
usually uses. This is why `0.1x + 0.2x` combines to exactly `0.3x` here, and not
the `0.30000000000000004x` that ordinary floating point would give. Like the
other algebra forms, this reads with a trailing arrow to show the simplified
result.

A bare number is exact too: a plain `0.1 + 0.2` is exactly 0.3 (see
[decimals](/syntax/decimals/)), and money keeps its decimals exact to the cent
(see [money precision](/syntax/money-precision/)). This page is about the
coefficient, the number in front of a variable term, which stays an exact
fraction all the way through the algebra.

```solve
0.1x + 0.2x => // 0.3x
x/3 + x/3 =>   // 2/3x
```

A coefficient that cannot be written as a short decimal stays a fraction rather
than being rounded into one.
