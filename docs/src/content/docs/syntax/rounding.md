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

## Significant figures

Significant figures count from the first digit that is not zero, which is how a
measured value is reported: a reading of 0.0012345 known to two figures is
0.0012, and a population of 1,234,567 to three figures is 1,230,000. `to N sf`
rounds to that many figures, and shows a trailing zero that is one of them, as
`to N dp` does. `sig figs` and `significant figures` are the long spellings.

```solve
1234567 to 3 sf // 1,230,000
0.0012345 to 2 sf // 0.0012
2.5 to 3 sf // 2.50
9.99 to 2 sf // 10
5.678 km to 2 sf // 5.7 km
```

The figure count runs from 1 to 17, the most a double carries.

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
