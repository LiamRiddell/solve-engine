---
title: Conditionals
description: Comparisons, booleans, and the conditional expression.
---

> **Package:** `CONDITIONALS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

```solve
5 > 3 // true
10 == 10 // true
3 != 4 // true
5 >= 5 // true
```

## Booleans

```solve
true and false // false
true or false // true
```

## Conditional expression

```solve
if 5 > 3 then 100 else 200 // 100
```

## Checks

A **check** is a line that states something the note should always keep true:
a budget that must cover the spending, two totals that must agree, a formula that
must stay close to a known value. Write `check` and a comparison. While it holds,
the line shows a quiet tick; the moment an edit breaks it, the line becomes an
error that names both sides, so a mistake is caught where it happens rather than
three lines further down.

```solve-doc
:budget = $1950
:spent = $2010
check :spent <= :budget // ERROR: check failed: $2,010.00 is more than $1,950.00
check 1 km == 1000 m // ✓
```

A check compares the way the comparison does anywhere else in the note. A
decimal, a fraction, an amount of money and a whole number past 2^53 each hold
their value exactly, and are checked on it; only a pair of approximate numbers,
such as the result of a unit conversion, is allowed the conversion's own
rounding. A failed check shows both sides to as many decimal places as it takes
to tell them apart, since at the usual two places `1.845` and `1.85` would both
read `1.85`:

```solve
check 2^53 + 1 > 2^53 // ✓
check 1.845 == 1.85 // check failed: 1.845 is not equal to 1.850
```

Two numbers worked out in different ways rarely match to the last digit, so a
check can allow a margin: `≈` (or `~=`) means approximately equal, and `within`
says how close is close enough, as a percentage of the right-hand side or as an
amount in the same unit. A passing approximate check says how far apart the two
sides were.

```solve
check 22/7 ≈ pi within 0.1% // ✓ (differs by 0.04%)
check 5 m ≈ 5.01 m within 1 cm // ✓ (differs by 0.01 m)
```

A check line is a statement about the numbers around it, not one of them, so a
`total above` beneath it steps over it, passed or failed. A program embedding the
engine gets a count of passed and failed checks on the parse result (`checks`), so
it can flag a note whose checks have started failing. Only a line written with
`check` is counted: a piece of text that happens to begin with a tick is text.

The boundary: `check` only means this at the start of a line that compares two
things, so a variable called `check` (a restaurant bill, say) keeps working.
Things that cannot be compared, such as a length and a mass, are refused as
incomparable rather than reported as a failed check, and text can only be
checked for being equal or not.

## A known limitation

The word `and` shares a binding power with addition, so an unparenthesised
comparison on both sides does not group the way you would expect. Parenthesise,
or use the symbol form.

```solve
(10 > 5) and (3 < 4) // true
```
