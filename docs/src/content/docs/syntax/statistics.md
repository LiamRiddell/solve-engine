---
title: Statistics
description: Averages, comparisons, proportions and other natural phrasings.
---

> **Packages:** `MATHPHRASES_PACKAGE` (averages, spread, comparisons) and `STATISTICS_PACKAGE` (correlation, regression, percentile, z-score, the normal distribution). Both registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

```solve
average of 10, 20, 30 // 20
median of 1, 5, 3 // 3
```

## A list that carries units

A list of quantities answers in a unit rather than as a bare number, and the
unit is the first one written. Everything after it is read in that unit, so a
set spelling one measure two ways adds up rather than needing to be retyped.

```solve
total of $4.99, $12.50, $3.20 // $20.69
total of 1.2 km, 3 km, 800 m // 5.00 km
total of 800 m, 1.2 km, 3 km // 5,000.00 m
```

The last two lines are the same three distances and the same answer, shown in
whichever unit the list opened with.

A list mixing measures has no unit both halves can be read in, so it is refused
rather than answered: `average of 5 kg, 3 m` reports *mass and length cannot be
averaged*. Adding a mass to a length is not a harder sum, it is a different
question, and a number here would be confidently wrong.

The same rule holds wherever a set is named, so a column of money totals to
money whether the lines are gathered by position with
[`total above`](/syntax/line-references/), by name with a
[category tag](/syntax/category-tags/), or by a line range.

```solve-doc
1.2 km
3 km
800 m
total above // 5.00 km
```

The boundary is a bare number sitting in a list of quantities. It contributes
its magnitude, which is what a count written beside a column of measurements has
always done, so `total of 1 km, 500` is `501.00 km`. And `count of` counts, so it
carries no unit at all.

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

## Relationships between two lists

The stats above describe one list. These describe how two lists move together:
whether taller people also tend to be heavier, and by how much. Give the two
lists as `[bracketed]` sets of the same length.

**Correlation** is a single number from -1 to 1: 1 means the two rise together in
perfect step, -1 means one rises exactly as the other falls, and 0 means no
straight-line relationship at all.

```solve
correlation of [1, 2, 3, 4] and [2, 4, 5, 8] // 0.98
```

The **line of best fit** is the straight line that sits closest to the points.
`slope` is how steep it is (how much the second list changes per step of the
first), and `intercept` is where it crosses zero.

```solve
slope of [1, 2, 3, 4] and [2, 4, 5, 8] // 1.90
intercept of [1, 2, 3, 4] and [2, 4, 5, 8] // 0
```

**r squared** is the share of the variation the line explains, from 0 to 1; it is
the correlation squared, and is written as a function.

```solve
rsquared([1, 2, 3, 4], [2, 4, 5, 8]) // 0.96
```

Each two-list form also has a call spelling, `correlation([a], [b])` and so on.
Two lists of different lengths, or fewer than two points, are reported as an
error rather than answered.

## Position and the normal distribution

A **percentile** is the value a given share of a list sits below: the 90th
percentile is the value nine tenths of the data fall under. The share is a number
from 0 to 100, and the 50th percentile is the median.

```solve
percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90) // 9.10
```

A **z-score** says how far one value sits from the average, measured in standard
deviations: a z-score of 2 is two standard deviations above the mean.

```solve
zscore(9, [2, 4, 4, 4, 5, 5, 7, 9]) // 2
```

The **normal distribution** is the bell curve much natural data follows.
`normalcdf(z)` gives the share of that curve to the left of a z-score (so
`normalcdf(1.96)` is about 0.975, the basis of a 95% interval), and
`normalpdf(z)` gives the height of the curve at that point.

```solve
normalcdf(1.96) // 0.98
normalpdf(0) // 0.40
```

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
