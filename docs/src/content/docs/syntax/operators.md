---
title: "Operators"
description: The arithmetic operators, in symbols and in words.
---

> **Package:** `ARITHMETIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

An operator is the sign that joins two numbers into a sum: `+` to add, `*` to
multiply, and so on. Solve reads the usual mathematical symbols, and it reads a
word form for each, so a line can be written whichever way reads more naturally.

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
