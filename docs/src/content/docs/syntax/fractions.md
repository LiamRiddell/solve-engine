---
title: "Fractions"
description: Exact quotients of whole numbers, shown as a decimal or a fraction.
---

> **Package:** `ARITHMETIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A fraction is one whole number over another, like `1/3`. Solve keeps such a
quotient exact rather than turning it into a decimal straight away, so a chain of
fractions adds up to the answer it should instead of drifting by a tiny amount.

A quotient of two whole numbers is kept as an exact fraction, so a chain of
fractions adds up the way it should rather than drifting the way the underlying
doubles do. `1/49 * 49` is exactly `1`, not `0.9999999999999999`.

```solve
1/3 + 1/3 + 1/3 // 1
2/7 * 14 // 4
1/49 * 49 // 1
```

A fraction is shown as a decimal by default, so a result still reads as a
number. Ask for `as fraction` to see it as a fraction, reduced to lowest terms,
and `as decimal` for the decimal.

```solve
1/3 as fraction // 1/3
10/4 as fraction // 5/2
(1/3 + 1/7) as fraction // 10/21
```

Only a fraction written with `/` is exact. A decimal literal is still floating
point, so `0.1 + 0.2` stays `0.30000000000000004`, and transcendental work
(`sqrt`, `sin`, a non-integer power) stays floating point too.
