---
title: "Number functions"
description: Common maths functions like square root, absolute value and greatest common divisor.
---

> **Package:** `FUNCTION_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A function takes one or more numbers and gives back another, written with the
name first and the inputs in brackets: `sqrt(16)` is the square root of sixteen.
These are the everyday maths functions, the ones a calculator keeps on its keys.

```solve
sqrt(16) // 4
abs(-5) // 5
round(3.7) // 4
floor(3.7) // 3
ceil(3.2) // 4
min(3, 7) // 3
max(3, 7) // 7
gcd(12, 18) // 6
```

`min` and `max` read quantities in a shared unit, so the longer distance wins
whichever unit each is written in. Given only dates, they give the earliest or
the latest date. A value with no numeric reading, such as a piece of text, is
refused rather than counted as zero, and so is a date among plain numbers.

```solve
max(1 km, 500 m) // 1.00 km
max(25/12/2026, 1/1/2027) // Friday, January 1, 2027
```
