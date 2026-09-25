---
title: Statistics
description: Averages, comparisons, proportions and other natural phrasings.
---

> **Packages:** `MATHPHRASES_PACKAGE` (averages, spread, comparisons) and `STATISTICS_PACKAGE` (correlation, regression, percentile, z-score, and the [probability distributions](/syntax/probability-distributions/)). Both registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

```solve
average of 10, 20, 30 // 20
median of 1, 5, 3 // 3
```

## The spreadsheet spellings

The same questions go by other names in a spreadsheet or another notepad, and
those names are read too. `sum of` is `total of`, `mean of` and `avg of` are
`average of`, and `min of`, `max of` and `product of` give the least value,
the greatest, and all of them multiplied together.

```solve
sum of 1, 2, 3 // 6
mean of 1, 2, 3 // 2
min of 4, 2, 9 // 2
max of $5, $7 and $3 // $7.00
product of 2 m, 3 m // 6.00 m²
```

A spreadsheet writes the values in brackets after the name instead, and that
works as well:

```solve
sum(1, 2, 3) // 6
average(4, 8) // 6
mean(1, 2, 3) // 2
median(1, 5, 3) // 3
stdev(1, 2, 3) // 0.82
```

`stdev(...)` is the population standard deviation, the same as `stdev of` and
`standard deviation of` on this page. A spreadsheet's `STDEV` is the sample
form, which is written `sample stdev of` (see [spread and shape](#spread-and-shape)).

Two other readings of the same brackets are kept. A call that names each
element and then gives the list is [map-reduce](/syntax/map-reduce-and-aggregates/)
(`sum(x, [10, 20, 30])`), and a call over lines is a
[line range](/syntax/line-references/) (`average(line 1 : line 4)`). `mean`,
`median` and `stdev` stay ordinary names wherever no bracket follows them, so
`mean = 4` is still a variable; a function of your own under one of those three
names is refused by name, since the call would never reach it.

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

A value that is not a number at all is refused the same way, by every form on
this page: a piece of text, a date or a clock time, a bracketed list, a colour.
Each of those used to be read as some number it happened to convert to, most
often zero, so `total of "Travel"` reported nothing spent. A quoted name is text,
not a set of lines; to add up the lines under a heading, name it as a section,
`total of section "Travel"` (see [sections](/syntax/sections/)), or tag the lines
and total the tag (see [category tags](/syntax/category-tags/)). A bracketed list
is one value, so write its members out with commas instead. `count of` counts
anything, text included.

```solve-doc
total of "Travel" // ERROR: Text cannot be added: only numbers and quantities can. To gather the lines under a heading, write total of section "Travel"; to gather tagged lines, use "total of #tag".
total of [1, 2, 3] // ERROR: A bracketed list cannot be added: only numbers and quantities can. List the values with commas instead, as in "total of 1, 2, 3".
total of 1, 2, 3 // 6
```

The same rule holds wherever a set is named, so a column of money totals to
money whether the lines are gathered by position with
[`total above`](/syntax/line-references/), by name with a
[category tag](/syntax/category-tags/) or a [section](/syntax/sections/), or by
a line range.

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
already means a `start:end` interval elsewhere. A tie for `mode` goes to the
value that reached the top count first, so the same list always gives the same
answer.

### The spread of quantities

The spread forms follow the rule for [a list that carries
units](#a-list-that-carries-units): the values are read in the first one's unit,
and the answer is in it. So 1 kg and 1000 g, which are the same mass, have no
spread at all, and the most common of 1 kg, 1000 g and 2 kg is 1 kg.

```solve
standard deviation of 1 kg, 1000 g // 0.00 kg
standard deviation of $10, $20, $30 // $8.16
mode of 1 kg, 1000 g, 2 kg // 1.00 kg
spread of 1 kg, 1000 g // 0.00 kg
```

A variance is the average of the squared distances from the mean, so it is in
the square of the data's unit. The engine has a unit for that only when the data
are lengths: the square of a length is an area. For anything else (kilograms
squared, dollars squared, degrees squared) there is no unit to give the answer,
so a variance of those is refused by name, the same way `(2 kg)^2` is. The
standard deviation is the same spread, in the data's own unit, and is the one to
ask for.

```solve
variance of 2 m, 4 m // 1.00 m²
variance of 1 kg, 1000 g // A variance of quantities in kg would be in kg squared, which has no unit: only a length squared has one, an area. The standard deviation is the same spread in kg.
```

Two measures in one list are refused as they are everywhere on this page, and a
list with an infinity in it has no standard deviation or variance, since an
infinite value is no finite distance from the mean.

```solve
standard deviation of 1 kg, 2 m // mass and length cannot be used in a standard deviation
standard deviation of 1/0, 1000 // A standard deviation of a list with an infinity in it has no value: an infinite value has no finite distance from the mean.
```

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

## Position in a list

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

A z-score is also where the bell curve comes in: `normalcdf` turns one into the
share of a normal population below it. The normal, binomial, Poisson and t
distributions have their own page, [probability distributions](/syntax/probability-distributions/).

Every statistics call refuses an argument it does not read, rather than quietly
leaving it out:

```solve-doc
percentile([1, 2, 3], 50, 9) // ERROR: percentile takes 2 arguments, but was given 3, as in percentile([1, 2, 3], 90)
zscore(1, [1, 2, 3], 5) // ERROR: zscore takes 2 arguments, but was given 3, as in zscore(5, [1, 2, 3])
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
