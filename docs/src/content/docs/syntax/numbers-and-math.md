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
