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

A decimal written with a point is exact as well (see
[decimals](/syntax/decimals/)), and the two meet cleanly. A decimal reads as the
fraction it is, so a fraction plus a decimal is still an exact fraction, and a
division of decimals that never ends, such as `0.1 / 3`, is kept as the fraction
1/30, the same way `1/3` is kept.

```solve
(1/3 + 0.1) as fraction // 13/30
(0.1 / 3) as fraction // 1/30
0.1 / 3 * 3 == 0.1 // true
```

The same holds for a decimal on its own. `as fraction` writes it as the fraction
its digits spell, reduced to lowest terms: 0.333333 is 333,333 millionths, and
3.14159 is 314,159 hundred-thousandths. It does not round a decimal onto a
simpler fraction it happens to be close to, so `0.3333333` is 3333333/10000000
and not a third. A third is written `1/3`, and is then exactly a third.

```solve
0.333333 as fraction // 333333/1000000
3.14159 as fraction // 314159/100000
0.3333333 as fraction // 3333333/10000000
0.125 as fraction // 1/8
$0.25 as fraction // 1/4
```

Transcendental work (`sqrt`, `sin`, a non-integer power) stays floating point,
because its answers have no exact fraction to keep. Asked for as a fraction, such
a value is given a close one instead, with a denominator of no more than a
million, since there is no exact one to write:

```solve
sqrt(2) as fraction // 47321/33461
```
