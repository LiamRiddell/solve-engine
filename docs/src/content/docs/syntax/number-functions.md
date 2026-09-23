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

## Trigonometry

`sin`, `cos` and `tan` relate an angle to the sides of a right-angled triangle:
the sine is the opposite side over the longest, the cosine the adjacent side over
the longest, and the tangent the opposite over the adjacent. A bare number is an
angle in radians, the convention maths and programming share, where a full turn
is 2π. Write `degrees` (or `grad`) after the angle to give it in those instead.

```solve
sin(30 degrees) // 0.50
cos(60 degrees) // 0.50
tan(45 degrees) // 1.00
sin(pi/2) // 1
```

The tangent grows without limit as the angle nears a right angle, and at exactly
90° (or 270°, or any odd number of right angles) it has no value at all. There it
is refused by name, rather than answered with the enormous finite number the
computer's nearest approximation to 90° produces. An angle close to it, but not
on it, still answers:

```solve-doc
tan(90 degrees) // ERROR: tan is undefined at 90 degrees: at an odd multiple of a right angle the tangent has no value, only an asymptote.
tan(89.9 degrees) // 572.96
```

The boundary: other special angles are not yet exact, so `sin(180 degrees)` is
the tiny 1.22e-16 the approximation of π leaves rather than 0. Exact special
angles are a planned addition.
