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

The brackets are optional for a single argument, which is how these are usually
written by hand.

```solve
sqrt 16 // 4
round 3.45 // 3
fact 5 // 120
ln 3 // 1.10
```

Without brackets the function takes the value next to it and stops there, so
`sqrt 16 + 9` is thirteen rather than five. A unit still belongs to the value.

```solve
sqrt 16 + 9 // 13
sin 45 deg // 0.71
```

Trigonometric functions take radians, and convert when the angle carries a unit.

```solve
sin(Pi/2) // 1
cos 60 deg // 0.50
sin 90 degrees // 1
```

`root` and `log` take a degree or base first, written before the bracketed
value.

```solve
root 2 (8) // 2.83
root 3 (27) // 3
log 2 (8) // 3
log 10 (1000) // 3
```

`log` with one argument is the natural logarithm, and `ln` is another name for
the same thing.

```solve
log(1) // 0
ln 1 // 0
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
