---
title: "Big integers"
description: Whole numbers past 9,007,199,254,740,991 stay exact, and the n suffix types one directly.
---

An ordinary number here is a *double*, the double-precision floating-point
value a spreadsheet or a JavaScript program also uses. A double holds every whole
number up to 9,007,199,254,740,991 exactly. That is 2^53 − 1, and the numbers up
to it are often called the *safe range*. Past it a double can hold only some whole
numbers, with gaps between them that widen as the numbers grow, so a result
landing in a gap has to be rounded to a neighbour.

## Whole numbers stay exact

When adding, subtracting, multiplying or raising whole numbers produces a result
past the safe range, the engine works it out exactly instead, and every digit is
shown. The answer is still an ordinary number: it can be stored in a variable,
compared, divided into a fraction or multiplied by money like any other.

```solve
2^53 // 9,007,199,254,740,992
2^53 + 1 // 9,007,199,254,740,993
3^40 // 12,157,665,459,056,928,801
2^64 // 18,446,744,073,709,551,616
fact(25) // 15,511,210,043,330,985,984,000,000
```

The operations that take a whole number and give one back read the exact value
too: the remainder (`mod`), the rounding functions, `gcd` and `lcm`,
`permutation` and `combination`, and writing a number in another base. So does
money, and a place count asked for with `to N dp`.

```solve
7^77 mod 13 // 11
3^40 mod 7 // 4
floor(2^53 + 1) // 9,007,199,254,740,993
lcm(2^40, 3^20) // 3,833,759,992,447,475,122,176
combination(56, 23) // 3,167,295,784,216,200
(2^53 + 1) as hex // 0x20000000000001
(2^60 + 1) * $1 // $1,152,921,504,606,846,977.00
3^40 to 2 dp // 12,157,665,459,056,928,801.00
```

## Where exactness stops

A whole number **typed** past the safe range in plain digits keeps the digits
typed. A double would round `9007199254740993` to the nearest number it can
hold, 9,007,199,254,740,992, and show that as if it were the number written, so
the digits are read as an exact integer instead, the same one `2^53 + 1` builds.

A number typed in scientific notation is different: `1e16` names a double, and a
double past the safe range may already be a rounding, so it keeps its double, and
so does arithmetic on it. The same number built from whole numbers within the
range is exact:

```solve
9007199254740993 // 9,007,199,254,740,993
12345678901234567890 + 1 // 12,345,678,901,234,567,891
1e16 + 1 - 1e16 // 0
10^16 + 1 - 10^16 // 1
```

A number typed with a decimal point keeps its digits too. Past the safe range a
double holds no fraction at all, so `9007199254740993.5` would be the double
9,007,199,254,740,994, and the half the reader typed would be gone. The engine
reads a decimal written in plain digits exactly, and where a double is too
coarse to hold the places shown, the digits come from that exact reading, and
from exact arithmetic on it:

```solve
9007199254740993.5 // 9,007,199,254,740,993.50
9007199254740993.5 + 1 // 9,007,199,254,740,994.50
9007199254740993.5 / 2 // 4,503,599,627,370,496.75
9007199254740993.5 == 9007199254740994 // false
2^60 + 0.5 // 1,152,921,504,606,846,976.50
```

Converting such a number keeps the exact reading too. `as int` drops the
fraction the way `int` and `trunc` do, towards zero, so a negative number loses
its fraction upwards; and `as percent`, which writes a number as a share of a
hundred, moves the point of the exact decimal two places:

```solve
9007199254740993.5 as int // 9,007,199,254,740,993
-9007199254740993.5 as int // -9,007,199,254,740,993
floor(9007199254740993.5) // 9,007,199,254,740,993
(2^53 + 1) as int // 9,007,199,254,740,993
9007199254740993.5 as percent // 900,719,925,474,099,350.00%
(2^53 + 1) as percent // 900,719,925,474,099,300.00%
```

The other limits:

- **A result with no exact reading.** A square root, a power with a fractional
  exponent or a logarithm has no exact decimal, so its result is a double, and so
  is arithmetic on it.
- **Past the largest double.** A double has no finite value beyond about
  1.8 × 10^308, and the answer there is infinity, as it always was.
- **A unit, or a percentage typed with its sign.** A quantity with a unit reads
  the nearest double, typed digits included (`9007199254740993 m` is
  9,007,199,254,740,992.00 m, `9007199254740993.5 m` is 9,007,199,254,740,994.00
  m, and `as int` of it is 9,007,199,254,740,994). So does a percentage written
  with `%` after a number that large (`900719925474099350%`); `as percent` of the
  number is the exact form. Money is the exception: an amount of money keeps its
  exact decimal at any size.

```solve
sqrt(2^106) + 0.5 // 9,007,199,254,740,992
2^1024 // ∞
(2^53 + 1) kg // 9,007,199,254,740,992.00 kg
```

For a program embedding the engine, the value of such a result is still the
nearest double, so existing code reading it is unaffected. The exact integer is
the value's `rational` (with a denominator of one), and the formatted result
shows its digits.

## Typing a big integer: the `n` suffix

> **Package:** `BIGINT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

To type a whole number past the safe range and keep every digit, suffix it with
`n`. The result is a big integer, a separate kind of number that holds a whole
number of any size. It is also what bitwise work past the 32-bit range needs, and
its division is whole-number division, which drops the remainder. A big integer
prints its digits without grouping.

```solve
12345678901234567890n + 1 // 12345678901234567891
123n * 2 // 246
7n / 2n // 3
1n << 40 // 1099511627776
```

A big integer and an exact result are the same number when their digits are,
so the two combine and compare on those digits: the `n` form of `3^40` is
`3^40`.

```solve
3^40 - 12157665459056928801n // 0
3^40 == 12157665459056928801n // true
(2^53 + 1) & 1n // 1
```
