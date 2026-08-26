---
title: Statistics
description: Averages, comparisons, proportions and other natural phrasings.
---

> **Package:** `MATHPHRASES_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

```solve
average of 10, 20, 30 // 20
median of 1, 5, 3 // 3
```

## Spread and shape

`average` and `median` find a list's centre; these four say how spread out it
is. Each reads a bare list, or a table column (see
[table columns](/syntax/table-columns/)).

```solve
standard deviation of 2, 4, 4, 4, 5, 5, 7, 9 // 2
variance of 2, 4, 4, 4, 5, 5, 7, 9 // 4
spread of 3, 7, 2, 9 // 7
mode of 4, 2, 4, 3, 4, 2 // 4
```

Standard deviation and variance take the **population** form by default, which
is what a note over a fixed column of readings usually is: the whole set, not a
draw from a larger one. The sample form (dividing by one less) is a named
variant.

```solve
sample standard deviation of 2, 4, 4, 4, 5, 5, 7, 9 // 2.14
```

`spread` is the largest minus the smallest, spelled that way because `range`
already means a `start:end` interval elsewhere. A tie for `mode` is broken by
first appearance, so the same list always gives the same answer.

## Weighted average

A plain average treats every value as equal; a weighted average pairs each value
with its own weight through `at`. The weights are normalised by their own total,
so they need not sum to 1 or to 100%.

```solve
weighted average of 72 at 30%, 88 at 70% // 83.20
weighted average of 4.0 at 3 credits, 3.0 at 1 credit // 3.75
weighted average of 10 at 2, 20 at 3 // 16
```

The grade-point case divides by the four credits, giving 3.75; percentages that
already sum to 100 come out unchanged. A trailing label on a weight (`3 credits`)
is read for the number and the word ignored. A value written with no `at` clause
is reported as an error rather than given a silent weight of 1, since guessing
one would quietly change the answer of a list that was simply mistyped.

## Comparisons and fractions

```solve
larger of 10 and 4 // 10
smaller of 10 and 4 // 4
half of 50 // 25
```

## Ranges and clamping

```solve
clamp 15 between 1 and 10 // 10
```

## Proportions

```solve
2 is to 4 as 5 is to what // 10
```

`random number between 1 and 10` gives a fresh value in that range each time, so
it is shown here rather than pinned to one result.
