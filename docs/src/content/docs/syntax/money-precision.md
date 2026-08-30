---
title: "Money precision"
description: Why money arithmetic is exact, and how the half-cent rounds.
---

> **Package:** `CURRENCY_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Money is exact. A price is a decimal, not a binary fraction, so amounts in the
same currency add, subtract, multiply and divide without the rounding error a
floating-point number carries. This is what keeps a column of prices adding up to
the cent instead of drifting by a fraction of a penny.

```solve
$0.10 + $0.20 // $0.30
$19.99 * 3 // $59.97
$100 - $99.99 // $0.01
$10 / 3 // $3.33
$0.70 * 1.10 // $0.77
```

A half-cent rounds away from zero, the way a till rounds it, rather than the way
`toFixed` rounds the nearest double sitting just below it.

```solve
$1.005 // $1.01
$2.675 // $2.68
$0.10 + 15% // $0.12
```

Exactness holds wherever a currency is involved, a currency against a plain
number included, and that includes adding a percentage: `$0.10 + 15%` is
`$0.115`, which the half-cent rule rounds up. A bare decimal on its own is an ordinary floating-point number,
and a conversion between two currencies goes through a live rate, which is not
exact.
