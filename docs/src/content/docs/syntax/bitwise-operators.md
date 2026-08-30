---
title: "Bitwise operators"
description: And, or, xor and complement on the bits of an integer, and how they nest.
---

> **Packages:** `ARITHMETIC_PACKAGE`, `FUNCTION_PACKAGE`, `CONVERTERS_PACKAGE`, `UOM_PACKAGE`, `BIGINT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

A bitwise operator combines two numbers bit by bit rather than as whole values:
`&` keeps a bit only where both have it, `|` where either does, `xor` where
exactly one does, and `~` flips every bit. These are the building blocks of flags
and masks.

`&` and `|` are and and or, `~` complements every bit, and exclusive or is the
word `xor`.

```solve
0xFF & 0x0F // 15
0xF0 | 0x0F // 255
0xFF xor 0x0F // 240
0b1010 & 0b0110 // 2
0b1010 | 0b0110 // 14
0b1010 xor 0b0110 // 12
~5 // -6
~0 // -1
```

`~` flips all 32 bits, which for a positive number means `~n` is `-(n+1)`.

Exclusive or is a word because `^` is already exponentiation, which is the far
more common thing to want on a page of sums. `2^10` is a thousand and change,
not three.

```solve
2^10 // 1,024
```

## Precedence

These operators follow the precedence order that C, JavaScript, Python and
their relatives share, so an expression that mixes them means what a programmer
reads it as. Loosest to tightest: `|`, then `xor`, then `&`, then the
comparisons, then the shifts, then `+` and `-`, then `*` and `/`.

```solve
1 | 2 << 3 // 17
1 + 2 << 3 // 24
4 & 3 + 1 // 4
4 | 6 & 3 // 6
```

Read those as `1 | (2 << 3)`, `(1 + 2) << 3`, `4 & (3 + 1)` and `4 | (6 & 3)`.
The arithmetic happens first, then the shift, then the bitwise operators, and
`&` wins against `|`.

Brackets still cost nothing, and on a line that mixes three or four of these
they read better than a precedence table does.

```solve
(0xF0 | 0x0F) & 0xFF // 255
(1 << 8) | 1 // 257
```

## One word to watch

`and` is not a bitwise operator. It is the plain English word, and it adds.

```solve
5 and 3 // 8
```
