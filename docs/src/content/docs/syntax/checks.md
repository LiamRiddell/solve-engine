---
title: Checks
description: Lines that state something the note must keep true, and say at once when it stops holding.
---

> **Package:** `CONDITIONALS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A **check** is a line that states something the note should always keep true:
a budget that must cover the spending, two totals that must agree, a formula that
must stay close to a known value. It is the notepad's version of an assertion in
a program, or of a spreadsheet cell that turns red when a figure goes wrong.

Write `check` and a comparison (see [conditionals](/syntax/conditionals/) for
the comparison signs). While it holds, the line shows a quiet tick; the moment an
edit breaks it, the line becomes an error that names both sides, so a mistake is
caught where it happens rather than three lines further down.

```solve-doc
:budget = $1950
:spent = $2010
check :spent <= :budget // ERROR: check failed: $2,010.00 is more than $1,950.00
check 1 km == 1000 m // ✓
```

A check usually reads the lines above it, by name or by line number, which is
why it belongs with the forms that work across lines. Change an input and every
check that depends on it is worked out again:

```solve-doc
:a = 3
:b = 4
check :a^2 + :b^2 == 25 // ✓
check :a^2 + :b^2 == 26 // ERROR: check failed: 25 is not equal to 26
```

## Exact values

A check compares the way the comparison does anywhere else in the note. A
decimal, a fraction, an amount of money and a whole number past 2^53 (the point
beyond which an ordinary floating-point number can no longer hold every whole
number) each hold their value exactly, and are checked on it; only a pair of
approximate numbers, such as the result of a unit conversion, is allowed the
conversion's own rounding. A failed check shows both sides to as many decimal
places as it takes to tell them apart, since at the usual two places `1.845` and
`1.85` would both read `1.85`:

```solve
check 2^53 + 1 > 2^53 // ✓
check 1.845 == 1.85 // check failed: 1.845 is not equal to 1.850
check 10 > 20 // check failed: 10 is not more than 20
```

## Allowing a margin

Two numbers worked out in different ways rarely match to the last digit, so a
check can allow a margin, a tolerance for how far apart the two sides may be and
still count as agreeing. `≈` (or `~=`) means approximately equal, and `within`
says how close is close enough, as a percentage of the right-hand side or as an
amount in the same unit. A passing approximate check says how far apart the two
sides were, and a failing one says by how much it missed.

```solve
check 22/7 ≈ pi within 0.1% // ✓ (differs by 0.04%)
check 5 m ≈ 5.01 m within 1 cm // ✓ (differs by 0.01 m)
check 1/3 ≈ 0.33 within 1% // check failed: 0.333333 differs from 0.33 by 1.01%, more than 1%
```

Without a `within`, `≈` reads the right-hand side as written to the decimal
places it has: the check asks whether the left side is that figure to those
places. Sixty miles an hour is 96.56064 km/h, so it is 96.56 km/h to two places
and not 96.5 to one. A whole number on the right allows no rounding, so `5.4 ≈ 5`
fails, and a figure worked out to every digit, such as `pi`, is held to the
engine's own rounding. Say how close is close enough with `within` whenever the
margin you mean is wider than the last written place.

```solve
check 60 mph ≈ 96.56 km/h // ✓ (differs by 0.000398 mph)
check 60 mph ≈ 96.5 km/h // check failed: 60 mph is not equal to 96.5 km/h
check 1/3 ≈ 0.333 // ✓ (differs by 0.000333)
check 5.4 ≈ 5 // check failed: 5.4 is not equal to 5
```

## Yes or no answers

A comparison answers true or false, and two such answers compare as equal or
not, as two pieces of text do. They have no order, so `<` between them is
refused, and `true` is not the number 1.

```solve
check !(1 > 2) == true // ✓
check (2 > 1) == (3 > 2) // ✓
check true == false // check failed: true is not equal to false
```

## Checks among the other lines

A check line is a statement about the numbers around it, not one of them, so a
`total above` beneath it steps over it, passed or failed:

```solve-doc
£900
£300
check line 1 + line 2 <= £1,000 // ERROR: check failed: £1,200.00 is more than £1,000.00
total above // £1,200.00
```

A program embedding the engine gets a count of passed and failed checks on the
parse result (`checks`, a `{ passed, failed }` pair present only when the
document has any; see [TypeScript usage](/guide/typescript-usage/)), so it can
flag a note whose checks have started failing. Only a line written with `check`
is counted: a piece of text that happens to begin with a tick is text.

## The boundary

`check` only means this at the start of a line that compares two things, so a
variable called `check` (a restaurant bill, say) keeps working:

```solve
check = 45
check * 2 // 90
```

Things that cannot be compared are refused as incomparable rather than reported
as a failed check, since "a metre is not a kilogram" is not a fact about the
note. Text can only be checked for being equal or not, because there is no order
between two pieces of text that a note would mean:

```solve
check 1 m == 1 kg // check: length and mass cannot be compared
check "a" == "a" // ✓
check "a" > "b" // check: text can only be compared with == or !=, not >
```
