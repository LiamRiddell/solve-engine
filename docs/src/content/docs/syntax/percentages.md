---
title: Percentages
description: Percent of, discounts and markups, increase and decrease, what percentage one number is of another, change between values, solving for the base, and percent beside permille and parts per million.
---

> **Package:** `PERCENTAGE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A percentage is a number out of a hundred: 25% is twenty-five hundredths, a
quarter. The engine reads a percentage as that fraction, so a percentage of a
value is that share of it.

```solve
50% of 200 // 100
10% of 250 // 25
```

The word does what the sign does, so a percentage can be written the way it is
said. `percent` and `percentage` after a number are the `%`; after `as`,
`in` or `to` they still ask for a number as a percentage.

```solve
15 percent of 60 // 9
0.25 as percent // 25.00%
```

## A discount and a markup

`N% off X` takes N% of X away from X, the way a sale price is worked out, and
`N% on X` adds it, the way a markup or a tax is added. They give what `X - N%`
and `X + N%` give, with the rate written first.

```solve
15% off 80 // 68
20% on 50 // 60
10% off $120 // $108.00
```

The rate is the percentage just before the word, and the base is everything
after it. So a discount inside a larger sum is worked out on its own, two in a
row apply one after the other (the second to what the first left), and a base
written as a sum is taken whole:

```solve
5 + 20% off 100 // 85
10% off 20% off $100 // $72.00
10% on 10% on 100 // 121
10% off 100 + 100 // 180
```

## Increase and decrease

Adding a percentage to a value adds that share of the value, and taking one
away takes it off, so `100 + 10%` is 110 rather than 100.1. The words say the
same thing.

```solve
increase 100 by 10% // 110
decrease 80 by 25% // 60
100 + 10% // 110
$80 - 25% // $60.00
```

The past tense reads the same way, and `reduce` is `decrease`:

```solve
50 increased by 20% // 60
50 decreased by 20% // 40
reduce 50 by 20% // 40
```

`reduce` is also [map-reduce](/syntax/map-reduce-and-aggregates/)'s call, so it
reads this way only before an amount and a `by` with a percentage after it;
`reduce(...)` with a bracket is still map-reduce.

## Successive change: up, down, then

Successive percentage changes compound, and this is the arithmetic people get
wrong most often. `up N%` and `down N%` apply a change to a value, and `then`
chains them so each change lands on the running total.

```solve
50 up 20% // 60
80 down 15% // 68
120 up 10% then down 10% // 118.80
```

The last line is the trap. It looks like it should return to 120, but the 10%
down comes off the larger 132, so the answer is 118.80. The unit rides along.

```solve
$300 up 10% then down 10% // $297.00
```

Repeat a step with `N times`, as a digit or a word.

```solve
100 up 10% three times // 133.10
```

## What percentage one number is of another

`X is what % of Y` asks what share X is of Y. With `on` or `off` in place of
`of`, it asks for the markup or the discount that takes Y to X. `X as % of Y`,
and NumPad's `X as a % of Y`, are the same questions in another order.

```solve
25 is what % of 200 // 12.50%
25 is what % on 20 // 25.00%
15 is what % off 20 // 25.00%
40 as % of 50 // 80.00%
$60 as a % on $50 // 20.00%
```

`more than` and `less than` ask how far one value is above or below another, as
a percentage of the other. The word works in place of the sign here too.

```solve
75 is what % more than 50 // 50.00%
20 is what % less than 50 // 60.00%
20 is what percent of 80 // 25.00%
```

With no base after it, `as %` writes a number as a percentage, and so do
`to %` and `in %`:

```solve
0.5 as % // 50.00%
1/8 as % // 12.50%
0.25 to % // 25.00%
20/80 in % // 25.00%
```

## Change between two values

`A to B` is the change from A to B as a percentage of A: how far it rose or
fell, measured against where it started.

```solve
100 to 150 // 50.00%
800 to 1000 // 25.00%
150 to 100 // -33.33%
10 to 0 // -100.00%
```

The question can be asked in words, with the same answer:

```solve
percent change from 50 to 75 // 50.00%
```

A change from zero has no percentage, since every multiple of zero is zero, and
a change from a negative base has two readings that disagree on the sign (the
rise measured against the base's size, or the ratio of the two less one), so
the engine refuses both rather than pick one:

```solve
0 to 10 // A change from zero has no percentage: every multiple of zero is zero, so no percentage of it reaches the new value. Give the difference instead, the new value minus the old.
-100 to -50 // A percentage change from a negative base has two readings, each the other's negative: the rise measured against the base's size, and the ratio of the two less one. Write the one you mean, as in (new - old) / abs(old).
```

Between two dates, `to` gives the span from one to the other instead; see
[date arithmetic](/syntax/date-arithmetic/).

## Solving for the base

When you know the percentage and the result but not the original: what 5% of
gives 6, and the price before a 20% markup or a 20% discount.

```solve
5% of what is 6 // 120
120 is 20% on what // 100
120 is 20% off what // 150
```

## Percent, permille and parts per million

A percent is one part in a hundred. A permille is one part in a thousand, and a
part per million (ppm) one in a million, the unit concentrations are measured
in. They are one scale: 1% is 10 permille and 10,000 ppm. So each converts to
the others, and a parts-per rate applies with `of` just as a percentage does.

```solve
100 ppm as % // 0.01%
0.5% in ppm // 5,000.00 ppm
2 permille of $5000 // $10.00
```

A quantity that is not a proportion, a length or a sum of money, has no
percentage, and is refused:

```solve
5 km as % // A length is not a proportion, so it has no percentage: only a number, a ratio or a parts-per quantity (ppm, permille) can be written as one.
```

## What it does not cover

- Only `of` reads a parts-per quantity as a rate. `*` keeps its unit, so
  `2 permille * 5000` is 10,000 permille: the same amount as 10, in the unit it
  was written in.
- A percentage of zero (`40 is what % of 0`), or of any value that is not a
  finite number, is refused rather than shown as an infinite percentage.
- A decimal comma in a percentage (`12,5%`) is not read yet, even under a
  locale that writes one.
