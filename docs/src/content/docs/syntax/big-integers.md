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

A number **typed** past the safe range is still a double, because it is rounded
as it is read, before any arithmetic happens. Its digits may already be different
from the ones typed, so working on it exactly would present invented digits as
though they were real. It keeps its double, and so does arithmetic on it. The same
number built from whole numbers within the range is exact:

```solve
12345678901234567890 + 1 // 12,345,678,901,234,567,000
1e16 + 1 - 1e16 // 0
10^16 + 1 - 10^16 // 1
```

The other limits:

- **A fractional part.** Only a whole-number result is kept exact, so a sum with
  a decimal in it is a double.
- **Past the largest double.** A double has no finite value beyond about
  1.8 × 10^308, and the answer there is infinity, as it always was.
- **A unit or a percentage.** A quantity with a unit, and a percentage of a
  number, read the nearest double.

```solve
2^60 + 0.5 // 1,152,921,504,606,847,000
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
