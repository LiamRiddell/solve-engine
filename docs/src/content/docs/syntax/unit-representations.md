---
title: "Other representations"
description: The general as form, converting a value to a percentage or an exact fraction.
---

> **Package:** `CONVERTERS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Some conversions do not change the unit, they change how a value is written:
the same number shown as a percentage, or as an exact fraction. The `as` form is
how you ask for one of these representations.

The `as` form is a general mechanism rather than a fixed list, and packages can
add their own targets.

```solve
0.5 as % // 50.00%
0.75 as fraction // 3/4
```

`as fraction` is exact for a value that was written as a fraction: the result is
reduced to lowest terms rather than approximated, so a computed fraction reads
back as itself. See [fractions](/syntax/fractions/).

```solve
10/4 as fraction // 5/2
(1/3 + 1/7) as fraction // 10/21
```
