---
title: "Uncertainty"
description: Carrying a measurement tolerance through arithmetic.
---

> **Package:** `UNCERTAINTY_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

An uncertainty is the give-or-take on a measurement: a reading of `12.3` that
could be off by `0.5` either way. Solve lets you attach that tolerance to a
number and carries it through the sums, so you do not have to track the error on
a second line.

A measurement can carry a tolerance, written `±` or the ASCII `+/-`, and the
tolerance travels through the arithmetic so you do not have to track it on a
second line. `12.3 ± 0.5` is the number 12.3 with a one-sigma uncertainty of
0.5.

```solve
12.3 +/- 0.5 // 12.3 ± 0.5
(12.3 +/- 0.5) * 4 // 49.2 ± 2.0
(10 +/- 1) + (20 +/- 2) // 30 ± 2.24
(100 +/- 5) + 10% // 110 ± 5.5
```

`+`, `-`, `*` and `/` propagate it, combining independent errors in quadrature:
a sum or difference adds the spreads as `sqrt(a² + b²)`, and a product or
quotient adds the relative spreads the same way. A plain number counts as an
exact value, so multiplying by one scales the spread; a percentage is a scalar
multiply too, so `(100 ± 5) + 10%` is `110 ± 5.5`. The `±` binds tighter than
`+ - * /`, so `12.3 ± 0.5 * 4` is `(12.3 ± 0.5) * 4`; parenthesise to group
otherwise.

Everything else reads the centre and drops the tolerance: a comparison compares
the centres, and `sqrt`, `sin` and the like work on the centre alone. Correlated
errors are out of scope.

## A tolerance as a percentage

A tolerance written as a percentage is relative to the value, the way a
component rated "± 5%" is read: `100 ± 5%` means within 5 of 100, and `12.3 ± 2%`
within 0.246 of 12.3.

```solve
100 +/- 5% // 100 ± 5.0
12.3 +/- 2% // 12.3 ± 0.25
(100 +/- 5%) * 2 // 200 ± 10.0
```

The one exception is a value that is itself a percentage. There the tolerance is
in percentage points, as a poll's margin of error is: `45% ± 3%` means somewhere
from 42% to 48%, not 45% give or take 3% of 45%. It shows as the proportion, since
the value's own percentage sign is not carried either.

```solve
45% +/- 3% // 0.45 ± 0.03
```

## A tolerance with a unit

A tolerance on a value with a unit drops the unit, so `5 m ± 1 m` is read as
`5 ± 1`, not carried as metres. When the tolerance is written in a different
unit from the value, it is converted into the value's unit first, so the spread
is the right size: a centimetre on a length in metres is 0.01. A temperature
tolerance is converted as a width rather than as a reading, so 1 °F on a Celsius
value is 5/9 of a degree.

```solve
5 m +/- 1 cm // 5 ± 0.01
5 km +/- 100 m // 5 ± 0.1
20 C +/- 1 F // 20 ± 0.56
```

A plain number as the tolerance is taken in the value's unit. A tolerance in a
unit that does not measure the same thing as the value, or one given on a value
with no unit to convert it into, is refused rather than having its unit quietly
discarded:

```solve-doc
5 m +/- 1 kg // ERROR: A tolerance in kg cannot be read against a value in m: they do not measure the same thing.
5 +/- 1 cm // ERROR: A tolerance in cm needs a value measured in a unit it converts to, as in "5 m +/- 1 cm"; this value has no unit to read it in.
```

## Converting a value that has a tolerance

Because the unit is dropped, a value with a tolerance has no unit left to
convert from. `(5 m +/- 1 cm) in mm` cannot honestly be 5 mm, since the length is
5,000 mm, so converting it is refused, and so is writing a unit straight after
it. The engine cannot tell a centre whose unit was dropped from one that never
had one, so `(5 +/- 0.1) in km` is refused the same way. Convert the value first
and give it the tolerance afterwards; the tolerance is then read in the unit the
value is in.

```solve
(5 m +/- 1 cm) in mm // A value with a tolerance cannot be converted to mm: a tolerance is read without its unit, so 5 m +/- 1 cm is the plain 5 ± 0.01. Convert the value first and give the tolerance after, as in (5 m in mm) +/- 10.
(5 +/- 0.1) km // A value with a tolerance cannot be converted to km: a tolerance is read without its unit, so 5 m +/- 1 cm is the plain 5 ± 0.01. Convert the value first and give the tolerance after, as in (5 m in mm) +/- 10.
(5 m in mm) +/- 10 // 5,000 ± 10.0
5000 mm +/- 1 cm // 5,000 ± 10.0
```

For the same reason a value with a tolerance cannot meet a quantity in `+`, `-`,
`*` or `/`. The quantity has a unit and the tolerance's value has none, so the
two are not in the same terms, and combining them used to give the answer the
quantity's unit and quietly lose the spread. Scaling by a plain number is
unaffected.

```solve
(5 m +/- 1 cm) + 2 m // A value with a tolerance and a quantity in m cannot be added: a tolerance is read without its unit, so 5 m +/- 1 cm is the plain 5 ± 0.01, and the two are not in the same terms. Keep both sides plain numbers, as in (5 +/- 0.01) + 2.
(5 +/- 0.1) * 2 m // A value with a tolerance and a quantity in m cannot be multiplied: a tolerance is read without its unit, so 5 m +/- 1 cm is the plain 5 ± 0.01, and the two are not in the same terms. Keep both sides plain numbers, as in (5 +/- 0.01) + 2.
(5 m +/- 1 cm) * 2 // 10 ± 0.02
```

Carrying the unit through the arithmetic, so that `(5 m +/- 1 cm) in mm` would
be 5,000 ± 10 mm, is not done yet; these refusals keep that answer open rather
than giving a wrong one meanwhile.
