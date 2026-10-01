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

A constant is a number like any other, so the word follows `pi`, `e`, `tau`,
`phi` and `golden ratio` as the sign does, and follows `prev`, the answer on
the line above. `pi percent` is pi hundredths, about 3.14%.

```solve
pi percent // 3.14%
e percent of 200 // 5.44
200 + pi percent // 206.28
tau percent // 6.28%
```

A constant with a unit, such as `gravity`, is a quantity rather than a number,
and a quantity has no percentage, so the word after it is not read as one.

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

The past tense reads the same way, and `reduce` is `decrease`. The value can
come first, followed by the change, in either tense:

```solve
50 increased by 20% // 60
50 decreased by 20% // 40
reduce 50 by 20% // 40
100 increase by 10% // 110
100 decrease by 10% // 90
100 reduced by 20% // 80
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

### A number as a percentage

With no base after it, `as %` writes a number as a percentage, and so do
`to %`, `in %` and `as percent`:

```solve
0.5 as % // 50.00%
1/8 as % // 12.50%
0.25 to % // 25.00%
20/80 in % // 25.00%
```

A percentage is its number a hundred times over, so a number can be an ordinary
finite one while its percentage is not. The largest number that can be held is
about 1.8e308, so past about 1.8e306 the percentage would be beyond it. Rather
than print an infinity with a percent sign, the line is refused and says why,
below zero as well as above it:

```solve
1e308 as % // This is too large to write as a percentage: a percentage is a hundred times the number, and that is past about 1.8e308, the largest number that can be held.
-1e308 in % // This is too large to write as a percentage: a percentage is a hundred times the number, and that is past about 1.8e308, the largest number that can be held.
```

A large percentage that can be held is written in full, every digit of its
whole part, as a large number is:

```solve
1e22 as % // 1,000,000,000,000,000,000,000,000.00%
```

A number can also be too large to be held at all before it is written as a
percentage. `2^2000` and a typed `1e309` are both past about 1.8e308, so each is
held as an infinity (shown `∞`), and its percentage is too large in the same
way. The refusal says so, in the same terms:

```solve
2^2000 as % // This is too large to write as a percentage: the number is past about 1.8e308, the largest number that can be held.
1e309 as % // This is too large to write as a percentage: the number is past about 1.8e308, the largest number that can be held.
```

A division by zero gives an infinity too, but not because a number grew too
large: there is no number it could be. That is a different refusal, which names
the division:

```solve
1/0 as % // This has no percentage: its value is not a finite number, which is what dividing by zero gives.
40 is what % of 0 // This has no percentage: its value is not a finite number, which is what dividing by zero gives.
```

The two infinities look the same once they are made, so the engine records
which one a division by zero gave, and keeps that record through `+`, `-`, `*`,
`^` and a minus sign in front (`1 - 40/0` is still a division by zero). The
boundary: a step that does not carry the record, such as a function
(`abs(1/0)`), leaves an infinity that is read as a number too large to hold.

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

### A change as a multiplier

`as multiplier` writes a change as how many times something grows: a rise of
50% is 1.5 times the start, and a plain number is taken as the multiple itself.
It takes a plain number or a percentage and nothing else, since text has no
number to grow by and a quantity's unit would be lost without a word:

```solve
50% as multiplier // 1.5x
(100 to 150) as multiplier // 1.5x
0.5 as multiplier // 0.5x
```

```solve-doc
5 km as multiplier // ERROR: A multiplier is a plain number or a percentage, as in "0.5 as multiplier" or "50% as multiplier", not a length.
```

## Solving for the base

When you know the percentage and the result but not the original: what 5% of
gives 6, and the price before a 20% markup or a 20% discount.

```solve
5% of what is 6 // 120
120 is 20% on what // 100
120 is 20% off what // 150
20% off what is $80 // $100.00
```

The last asks the same question with the rate first: the price that a 20%
discount brings down to $80.

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

## A percentage and a list

A list (a row of numbers in square brackets, see
[vectors and matrices](/syntax/vectors-and-matrices/)) is a set of values
worked on together, such as a column of prices. A percentage added to a list,
or taken from one, is a share of each value in it, exactly as it is of one
number: a 10% rise on a list of prices raises every price by a tenth of
itself. A list of quantities or money keeps its unit.

```solve
[100, 200] + 10% // [110, 220]
[100, 200] - 10% // [90, 180]
[100 m, 200 m] + 10% // [110.00 m, 220.00 m]
[$100, $200] - 10% // [$90.00, $180.00]
```

Every other way of writing a percentage of a value works on a list the same
way, value by value: `of`, a discount or markup, multiplying and dividing.

```solve
10% of [100, 200] // [10, 20]
15% off [$80, $120] // [$68.00, $102.00]
20% on [50 kg, 60 kg] // [60.00 kg, 72.00 kg]
[100 m, 200 m] * 10% // [10.00 m, 20.00 m]
```

Each value is worked out as it would be on a line of its own, so money stays
exact to the cent, and a percentage held in a variable reads the same way:

```solve-doc
prices = [$19.99, $5.00] // [$19.99, $5.00]
vat = 20% // 20.00%
prices + vat // [$23.99, $6.00]
```

The boundary: a percentage written before a plain list with `+` or `-` is
refused by name. For one number, `10% + 100` is the percentage 10,010%, and a
list holds plain numbers, not percentages, so the answer would be shown as
fractions nobody meant. The refusal gives the order that adds the percentage
to each value. Before a list of quantities or money, a percentage reads as it
does before one amount (`10% + $5` is $5.50), so there it is answered. These
answers used to be wrong: `[100, 200] + 10%` added 0.1 to each value and
answered `[100.10, 200.10]`, and a list with a unit refused a percentage.

```solve
10% + [100, 200] // A percentage plus a list would be a list of percentages, and a list holds plain numbers. To add the percentage to each number, write the list first, as in [100, 200] + 10%.
10% + [$100, $200] // [$110.00, $220.00]
```

A percentage cannot be a value inside a list either. A list holds plain
numbers, so `[10%, 20%]` would keep each percentage as its fraction, 0.1 and
0.2, and adding that list to prices would add 0.1 and 0.2 rather than a tenth
and a fifth. A list with a percentage in it is refused by name, with the two
forms that say what was meant: one percentage outside the list, applied to
every value, or the fractions written as numbers. To raise each price by its
own share, work the amounts out and add them as a list.

```solve
[10%, 20%] // A list holds plain numbers, so it cannot hold 10% as a percentage. To take a share of each number, put the percentage outside the list, as in [100, 200] + 10%; to keep the fraction, write it as a number (0.1 for 10%).
[100, 200] + [10%, 20%] // A list holds plain numbers, so it cannot hold 10% as a percentage. To take a share of each number, put the percentage outside the list, as in [100, 200] + 10%; to keep the fraction, write it as a number (0.1 for 10%).
[100, 200] + [10, 40] // [110, 240]
[0.1, 0.2] // [0.10, 0.20]
```

The boundary: the refusal covers every way a list is made, so `map(x%, [10,
20])` is refused as the literal is, and a sum, an average or a product of such a
list never runs. These used to answer with the fractions: `[10%, 20%]` was
`[0.10, 0.20]`, `sum([10%, 20%])` was 0.30 rather than 30%, and `[100, 200] +
[10%, 20%]` was `[100.10, 200.20]`.

To add up or average percentages, list them with commas rather than brackets,
or put each on a line of its own and total the lines: a set of percentages
answers a percentage, and a percentage beside a plain number is refused by name
(see [a list of percentages](/syntax/statistics/#a-list-of-percentages)).

```solve
sum(10%, 20%) // 30.00%
average of 10%, 20% // 15.00%
```

## A percentage as a multiplier

A multiplier is the number a value is multiplied by to apply a change: a 20%
rise multiplies by 1.2, the factor a spreadsheet formula or a price list uses.
`as multiplier` turns a percentage into that factor, and shows a plain number as
one, with an `x` after it. The conversion is read by `CONVERTERS_PACKAGE`, which
`createEngine()` registers.

```solve
20% as multiplier // 1.2x
150% as multiplier // 2.5x
0.5 as multiplier // 0.5x
```

## What it does not cover

- Only `of` reads a parts-per quantity as a rate. `*` keeps its unit, so
  `2 permille * 5000` is 10,000 permille: the same amount as 10, in the unit it
  was written in.
- A percentage of zero (`40 is what % of 0`), or of any value that is not a
  finite number, is refused rather than shown as an infinite percentage, and so
  is a number too large for a hundred times it to be held (`1e308 as %`, and
  `2^2000 as %`, which is too large to hold even before it is a percentage).
- Adding a percentage multiplies, so an increase can grow past about 1.8e308,
  the largest number that can be held. The answer is then an infinity, written
  `∞`, as `2^1024` is: `200 + 1e308%` is `∞`. It is the value the arithmetic
  reached, not a refusal, and a later line can still compare it (`∞ > 5` is
  true) or divide by it (`1/∞` is 0).
- A decimal comma in a percentage (`12,5%`) is read only by an engine whose
  locale writes one, German or French (see [locales](/guide/locales/#the-decimal-comma));
  an English engine refuses it, as it refuses `12,5` alone.
