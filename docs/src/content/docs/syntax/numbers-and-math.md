---
title: Numbers and maths
description: Arithmetic, operators, functions, big integers and number suffixes.
---

## Operators

```solve
2 + 2 * 10 // 22
(2 + 3) * 4 // 20
10 - 4 // 6
20 / 4 // 5
2^10 // 1,024
17 mod 5 // 2
```

`%` is the percent operator, not modulo. Writing `17 % 5` is a parse error
because `17 %` is already a complete expression. Use `mod` or `modulo`.

`^` is the only operator that groups from the right. A tower of powers is
worked out from the top down, as in mathematics: `2^3^2` means `2^(3^2)`, which
is 2^9. Everything else groups from the left, so `10-3-2` is `(10-3)-2`.

```solve
2^3^2 // 512
(2^3)^2 // 64
```

## Operators in words

Most operators have a word form, which is often how a line reads more naturally.

```solve
8 times 9 // 72
2 plus 3 // 5
5 minus 3 // 2
10 divide by 2 // 5
3 multiplied by 4 // 12
```

`with` adds and `without` subtracts, which reads well for a running total.

```solve
40 with 2 // 42
40 without 2 // 38
```

## Suffixes

```solve
2.5k // 2,500
3M // 3,000,000
```

## Decimals

A number written with a decimal point is an ordinary IEEE floating-point value,
so `0.1 + 0.2` is the usual `0.30000000000000004` and transcendental work stays
in floating point where it belongs. Money is the exception: amounts in a
currency are held as exact decimals, so `$0.10 + $0.20` is `$0.30`. See
[money and finance](/syntax/money-and-finance/) for what that covers.

## Fractions

A quotient of two whole numbers is kept as an exact fraction, so a chain of
fractions adds up the way it should rather than drifting the way the underlying
doubles do. `1/49 * 49` is exactly `1`, not `0.9999999999999999`.

```solve
1/3 + 1/3 + 1/3 // 1
2/7 * 14 // 4
1/49 * 49 // 1
```

A fraction is shown as a decimal by default, so a result still reads as a
number. Ask for `as fraction` to see it as a fraction, reduced to lowest terms,
and `as decimal` for the decimal.

```solve
1/3 as fraction // 1/3
10/4 as fraction // 5/2
(1/3 + 1/7) as fraction // 10/21
```

Only a fraction written with `/` is exact. A decimal literal is still floating
point, so `0.1 + 0.2` stays `0.30000000000000004`, and transcendental work
(`sqrt`, `sin`, a non-integer power) stays floating point too.

## Uncertainty

A measurement can carry a tolerance, written `±` or the ASCII `+/-`, and the
tolerance travels through the arithmetic so you do not have to track it on a
second line. `12.3 ± 0.5` is the number 12.3 with a one-sigma uncertainty of
0.5.

```solve
12.3 +/- 0.5 // 12.3 ± 0.5
(12.3 +/- 0.5) * 4 // 49.2 ± 2.0
(10 +/- 1) + (20 +/- 2) // 30 ± 2.24
(100 +/- 5) + 10% // 110 ± 5.5
```

`+`, `-`, `*` and `/` propagate it, combining independent errors in quadrature:
a sum or difference adds the spreads as `sqrt(a² + b²)`, and a product or
quotient adds the relative spreads the same way. A plain number counts as an
exact value, so multiplying by one scales the spread; a percentage is a scalar
multiply too, so `(100 ± 5) + 10%` is `110 ± 5.5`. The `±` binds tighter than
`+ - * /`, so `12.3 ± 0.5 * 4` is `(12.3 ± 0.5) * 4`; parenthesise to group
otherwise.

Everything else reads the centre and drops the tolerance: a comparison compares
the centres, and `sqrt`, `sin` and the like work on the centre alone. Correlated
errors, and a tolerance on a value with a unit, are out of scope.

## Functions

```solve
sqrt(16) // 4
abs(-5) // 5
round(3.7) // 4
floor(3.7) // 3
ceil(3.2) // 4
min(3, 7) // 3
max(3, 7) // 7
gcd(12, 18) // 6
```

## Rounding

`round` on its own goes to the nearest whole number. Give it a place count, or
say `to N dp`, to round to that many decimal places and show exactly that many,
trailing zeros kept.

```solve
round(3.7) // 4
round(3.14159, 2) // 3.14
3.14159 to 4 dp // 3.1416
1.5 to 2 dp // 1.50
100 to 2 dp // 100.00
```

The place count is a precision you set on the value, not a global display
setting, so a rounded number reads the way you asked and carries that precision
into the next line. The rounding is exact where the number has an exact decimal,
so a half at the last place goes up rather than down.

```solve
1.005 to 2 dp // 1.01
round(2.675, 2) // 2.68
```

Rounding to a magnitude reads the way it is said. `rounded` with no target is the
nearest whole; `up` and `down` force the direction; `to nearest <n>` rounds to a
multiple, and the round magnitude words (`ten`, `hundred`, `thousand`, …) stand
in for the number.

```solve
5.5 rounded // 6
5.4 rounded up // 6
5.6 rounded down // 5
37 to nearest 10 // 40
490 rounded to nearest hundred // 500
21 rounded up to nearest 5 // 25
```

## Bases

Numbers can be written and displayed in hexadecimal, binary or octal.

```solve
0xFF // 255
hex(255) // 0xFF
bin(5) // 0b101
255 as hex // 0xFF
255 as binary // 0b11111111
```

Bit shifts, bitwise operators and data-size units are on the
[programmer math](/syntax/programmer-math/) page.

## Big integers

Suffix an integer with `n` to keep full precision beyond the safe range for
ordinary numbers.

```solve
123n * 2 // 246
```
