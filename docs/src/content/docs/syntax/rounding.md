---
title: "Rounding"
description: Rounding to a number of decimal places, a direction, or a magnitude.
---

> **Package:** `FUNCTION_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Rounding replaces a number with a nearby simpler one: the nearest whole number, a
set number of decimal places, or the nearest ten, hundred or thousand. Solve has
a form for each, in symbols and in words, so you can say the one you mean.

`round` on its own goes to the nearest whole number. Give it a place count, or
say `to N dp`, to round to that many decimal places and show exactly that many,
trailing zeros kept.

```solve
round(3.7) // 4
round(3.14159, 2) // 3.14
3.14159 to 4 dp // 3.1416
1.5 to 2 dp // 1.50
100 to 2 dp // 100.00
```

The place count is a precision you set on the value, not a global display
setting, so a rounded number reads the way you asked and carries that precision
into the next line. The rounding is exact where the number has an exact decimal,
so a half at the last place goes up rather than down.

```solve
1.005 to 2 dp // 1.01
round(2.675, 2) // 2.68
```

Rounding to a magnitude reads the way it is said. `rounded` with no target is the
nearest whole; `up` and `down` force the direction; `to nearest <n>` rounds to a
multiple, and the round magnitude words (`ten`, `hundred`, `thousand`, …) stand
in for the number.

```solve
5.5 rounded // 6
5.4 rounded up // 6
5.6 rounded down // 5
37 to nearest 10 // 40
490 rounded to nearest hundred // 500
21 rounded up to nearest 5 // 25
```
