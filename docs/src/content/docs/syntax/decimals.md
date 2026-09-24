---
title: "Decimals"
description: How a number with a decimal point is held, and where exactness applies.
---

> **Package:** `ARITHMETIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A decimal is a number written with a point, like `0.1`. Solve keeps it as the
exact decimal you typed and does its arithmetic in base ten, the way you would on
paper, so an answer and a comparison of that answer always agree.

## Why a computer gets 0.1 + 0.2 wrong

Most software stores a number as *binary floating point* (the IEEE 754 double):
a fixed number of binary digits and an exponent, the way scientific notation is a
fixed number of decimal digits and a power of ten. It is fast and covers an
enormous range, but in binary the only fractions that come to an end are the ones
whose denominator is a power of two. A tenth is not one of them. Written in
binary, 0.1 repeats for ever, the way a third does in decimal (0.333...), so the
computer keeps the nearest value it can hold, which is a hair above 0.1.

Add two of those approximations and the errors add up: in floating point,
`0.1 + 0.2` is `0.30000000000000004`. A calculator that rounds its display to two
places hides that, and then contradicts itself on the next line, showing `0.30`
and saying `0.1 + 0.2 == 0.3` is false.

## Decimals are exact

Solve does not have that problem, because a decimal keeps its digits. The answer
on screen is the one it always was (`0.1 + 0.2` shows `0.30`), and now everything
that reads the answer agrees with it.

| Expression | Floating point gives | Solve gives |
| --- | --- | --- |
| `0.1 + 0.2 == 0.3` | false | true |
| `1.1 * 1.1 == 1.21` | false | true |
| `0.1 + 0.2 - 0.3` | 5.55e-17 | 0 |
| `0.3 / 0.1` | 3.00 | 3 |
| `floor((0.7 + 0.1) * 10)` | 7 | 8 |
| `100 + 10%` | 110.00 | 110 |

```solve
0.1 + 0.2 // 0.30
0.1 + 0.2 == 0.3 // true
1.1 * 1.1 == 1.21 // true
0.1 + 0.2 - 0.3 // 0
floor((0.7 + 0.1) * 10) // 8
```

This is the same exact arithmetic money has always had (see
[money precision](/syntax/money-precision/)), without the currency.

## What stays exact

Adding, taking away and multiplying decimals is always exact, and a whole number
mixed in (`0.1 * 3`) is exact too.

Dividing is exact when the answer has a decimal that ends: `0.3 / 0.1` is 3 and
`1 / 0.8` is 1.25. When it never ends (`0.1 / 3` is 0.0333... for ever), the
answer is kept as the exact fraction 1/30, the way `1/3` is kept (see
[fractions](/syntax/fractions/)), so multiplying it back gives exactly 0.1.

A whole power is repeated multiplication, so `1.1 ^ 2` is exactly 1.21. A
remainder is exact, and so is adding, taking away or finding a percentage, which
is a decimal too (`10%` is 0.10).

```solve
0.3 / 0.1 // 3
1 / 0.8 // 1.25
0.1 / 3 * 3 == 0.1 // true
1.1 ^ 2 == 1.21 // true
0.5 mod 0.2 == 0.1 // true
100 + 10% // 110
0.1 + 10% == 0.11 // true
```

Comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`) are decided on the exact values,
and so is the test in a conditional.

```solve
if 0.1 + 0.2 == 0.3 then "equal" else "different" // equal
```

Rounding reads the exact value too. `to N dp`, `round`, `floor` and `ceil` round
the decimal itself, so a value that is exactly half way rounds away from zero, the
way money's half-cent does. In floating point `0.5 + 0.505` lands just below
1.005 and rounds down; here it is exactly 1.005 and rounds up. Asking for many
places shows the exact digits rather than the approximation behind them.

```solve
(0.5 + 0.505) to 2 dp // 1.01
(0.1 + 0.2) to 17 dp // 0.30000000000000000
```

A total or an average is exact as well: of a list (`total of 0.1, 0.2`), of the
lines above, of a range of lines, of a [category tag](/syntax/category-tags/), or
of a [table column](/syntax/table-columns/).

```solve-doc
0.1
0.2
total above // 0.30
line 3 == 0.3 // true
```

## Where exactness ends

Some answers have no exact decimal or fraction to keep, and a few inputs are read
as floating point on purpose. There, Solve uses floating point, as it always has.

- **Irrational results.** A square root, a logarithm, a trigonometric function
  and `pi` have digits that never end or repeat, so they are worked out in
  floating point, and `sqrt(2) * sqrt(2) == 2` is false. For exact algebra with
  roots, see [symbolic](/syntax/symbolic/).
- **Scientific notation.** `2.5e-3` is read as a floating-point number. That
  notation is how a very large or very small magnitude is written, and reading it
  as floating point is what keeps a typed `1e16` from being given digits it never
  had (see [big integers](/syntax/big-integers/)). Write the decimal out when you
  want it exact.
- **Past 34 digits.** An exact answer can carry up to 34 digits, and up to 34 of
  them after the point, which is the precision of IEEE 754's decimal128 format and
  about twice what floating point holds. A longer answer is given in floating
  point. Compound growth over thirty years, `1.05 ^ 30`, is 61 digits long, so it
  is floating point, and shows the same `4.32` either way.
- **Other kinds of value.** A quantity with a unit other than money, a
  measurement with an [uncertainty](/syntax/uncertainty/), a
  [statistic](/syntax/statistics/) such as a median, and the entries of a
  [matrix](/syntax/vectors-and-matrices/) are floating point. A comparison of two
  quantities with units allows for the tiny rounding a unit conversion introduces
  (see [unit arithmetic](/syntax/unit-arithmetic/)), so `0.1 km + 0.2 km == 0.3 km`
  is still true.

```solve
sqrt(2) * sqrt(2) == 2 // false
1e-1 + 2e-1 == 3e-1 // false
1.05 ^ 30 // 4.32
0.1 km + 0.2 km == 0.3 km // true
```

## Numbers too small for two decimal places

Results are shown to two decimal places, which is right for almost everything
and wrong for the answers that live below it. A conversion can land several
orders of magnitude down, and `0.00 MHz` cannot be told apart from a real zero.

So a value that is not zero is never shown as one. Below the ordinary budget it
is shown to three significant digits: as a decimal while the zeros are still
countable, and in exponent form once they are not.

```solve
1 Hz in MHz // 1e-6 MHz
1 byte in GB // 1e-9 GB
1 second in years // 3.17e-8 years
0.001 km // 0.001 km
```

Three digits, rather than everything the double holds, because a conversion is
not more precise than what went into it: `1 second in years` is
`3.17e-8 years`, not the seventeen digits behind it.

Money is the exception, because a currency zero is a real answer rather than a
rounding artefact. A tenth of a penny is not a payable amount, so `$0.001` is
`$0.00` and stays that way.

## Asking for a representation

`as scientific` shows any number in exponent form, whether or not it is small
enough for the engine to reach for one. `sci` is the short spelling.

```solve
1 Hz in MHz as scientific // 1e-6
1500000 as scientific // 1.5e+6
0.25 as sci // 2.5e-1
```

`as engineering` (or `as eng`) is scientific notation with the exponent kept to a
multiple of three, the steps the metric prefixes take: `12.345e+3` is twelve
thousand and a bit, where scientific notation would write `1.2345e+4`. It is how
an engineer reads a value straight off as kilo, mega or micro.

`as compact` writes a large figure the way a report headlines it, with a letter
for the thousands, millions, billions or trillions, rounded to three significant
figures. The letters are the ones the engine reads back as input, `k`, `M`, `B`
and `T` (see [number suffixes](/syntax/number-suffixes/)), so `3.3M` typed back
in is 3,300,000 again.

```solve
12345 as engineering // 12.345e+3
0.00012 as eng // 120e-6
3 million + 10% as compact // 3.3M
1234 as compact // 1.23k
$3300000 as compact // $3.3M
```

Both answer text, the way `as scientific` does, so they end a line rather than
feed further arithmetic.

And `to N dp` asks for an exact number of decimal places, on a quantity as much
as on a plain number. It overrides the display rules above in both directions,
because a line that names its precision has said what it wants.

```solve
1.23456 km to 4 dp // 1.2346 km
5 km to 0 dp // 5 km
```
