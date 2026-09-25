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

A function that changes a quantity's size without changing what it measures
keeps its unit: the rounding family (`round`, `floor`, `ceil`, `trunc`), `abs`,
and `hypot`, the long side of a right-angled triangle, whose short sides are
read in a shared unit. A function that counts, such as `fact`, `gcd` or
`combination`, takes plain numbers, and refuses a quantity by name rather than
counting its bare number.

```solve-doc
trunc(3.7 m) // 3.00 m
hypot(3 m, 400 cm) // 5.00 m
fact(3 m) // ERROR: fact takes a plain number, not a length
```

`root(n, x)` is the nth root of x. A negative number has a real root of odd
degree, since -2 cubed is -8, and none of even degree, which is refused by name
as `(-1)^0.5` is.

```solve-doc
root(3, -8) // -2
root(2, -4) // ERROR: root(2, -4) has no real value: a negative number has a real root only of odd degree, as in root(3, -8).
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
tan(45 degrees) // 1
sin(pi/2) // 1
```

An angle is what these take, so a quantity that is not an angle is refused. The
sine of a length has no meaning, and read as its bare number the answer would
depend on which unit happened to be written: one metre and a hundred centimetres
would give different sines. The logarithms, `exp`, and the inverse and hyperbolic
functions take a plain number and refuse any quantity the same way. A ratio of
two lengths is a plain number, so it is accepted. The degree forms, `sind`,
`cosd` and `tand`, read a bare number as degrees and an angle in its own unit,
so `sind(1 rad)` is the sine of one radian.

```solve-doc
sin(1 m) // ERROR: sin takes an angle or a plain number, not a length
log(10 kg) // ERROR: log takes a plain number, not a mass
sin(1 m / 2 m) // 0.48
```

The angles people actually type, 0, 30, 45, 60 and 90 degrees and their
multiples, and the same angles written with π, give exact answers. A computer
holds none of those angles exactly (π itself has no exact binary form), so the
sine of its nearest approximation to 180° is a tiny 0.000000000000000122 rather
than 0. The engine recognises an angle that is one of these to within that
rounding and answers with the exact value instead.

```solve
sin(180 degrees) // 0
cos(90 degrees) // 0
sin(pi) // 0
sin(45 degrees) // 0.71
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

The boundary: exactness covers the multiples of 30° and 45°. An irrational
exact value such as the sine of 45°, a half of the square root of two, is the
nearest double to it, shown to the usual places. Any other angle is computed as
before.

## Outside a function's domain

Some functions only have a real answer for part of the number line: a logarithm
for positive numbers, the inverse sine and cosine for numbers from -1 to 1. Asked
outside that range, the computer's maths library answers anyway, with a
negative infinity for `log(0)` or `NaN` (not a number) for `asin(2)`, neither of
which is an answer. These are refused by name, saying what the function accepts.

```solve-doc
log(0) // ERROR: log(0) has no real value: log is only defined for positive numbers.
asin(2) // ERROR: asin(2) has no real value: asin is only defined for numbers from -1 to 1.
```

The same holds for `log10`, `log2`, `log1p`, `acos`, `acosh`, `atanh` and the
degree forms `asind` and `acosd`. An infinite angle has no sine, cosine or
tangent, so `sin`, `cos`, `tan` and their degree forms refuse one the same way. A
square root of a negative number is not refused: it has an exact complex answer,
so `sqrt(-1)` is `i`. Division by zero is left as it was, infinity for `1/0`,
which is the floating-point standard's defined answer rather than a function's
missing one.

```solve-doc
sin(1/0) // ERROR: sin(Infinity) has no real value: sin is only defined for finite angles.
```
