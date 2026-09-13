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

The exactness is a property of a term's coefficient, not of a bare number. A
plain `0.1 + 0.2` is still ordinary floating point (`0.30000000000000004`); it is
the coefficient carried by a variable term that stays exact. Money is the other
place the engine keeps exact decimals, to the cent (see
[money precision](/syntax/money-precision/)).

```solve
0.1x + 0.2x => // 0.3x
x/3 + x/3 =>   // 2/3x
```

A coefficient that cannot be written as a short decimal stays a fraction rather
than being rounded into one.
