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

```solve
hex(255) // 0xFF
bin(5) // 0b101
255 as hex // 0xFF
255 as binary // 0b11111111
```

## Big integers

Suffix an integer with `n` to keep full precision beyond the safe range for
ordinary numbers.

```solve
123n * 2 // 246
```
