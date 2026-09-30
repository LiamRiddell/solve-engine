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

`mod` gives the remainder left over after dividing, the 2 in "17 is three fives
and 2 over". A remainder by zero has none, since the division never ends, and
neither does a remainder of an infinite number, so both are refused by name.

```solve-doc
5 mod 0 // ERROR: 5 mod 0 has no value: nothing is left over from a division by zero, because it never ends.
```

Dividing by zero follows the same idea. A number divided by something ever
closer to zero grows without limit, so `5/0` answers infinity, with the sign the
division would have. Zero divided by zero has no such limit: every number times
zero is zero, so every number is an equally good answer, and none is given.
It is refused by name rather than answered with NaN (not a number), and so is an
infinity divided by an infinity, for the same reason.

```solve-doc
5/0 // ∞
-5/0 // -∞
0/0 // ERROR: 0 divided by 0 has no single answer: every number times 0 is 0, so no one quotient is right.
```

The boundary: only a division is refused. An infinity less an infinity (`1/0 -
1/0`) is still NaN, and a list divided cell by cell (`[0, 1] / 0`) keeps a NaN
cell, since one cell of a list has no room for a refusal.

`^` is the only operator that groups from the right. A tower of powers is
worked out from the top down, as in mathematics: `2^3^2` means `2^(3^2)`, which
is 2^9. Everything else groups from the left, so `10-3-2` is `(10-3)-2`.

```solve
2^3^2 // 512
(2^3)^2 // 64
```

A minus sign at the front of a number belongs to the number, so it is applied
before a power: `-2^2` is `(-2)^2`, which is 4. That is how a spreadsheet reads
it, and not how a maths textbook does, where `-2^2` is `-(2^2)`, which is -4.
Neither reading is wrong, so write the brackets whenever it matters. A minus
between two numbers is subtraction and waits for the power as usual.

```solve
-2^2 // 4
-(2^2) // -4
0 - 2^2 // -4
```

A fractional power is a root: `8^(1/3)` is the cube root of eight, 2. A negative
number has a real root when the root is odd, since -2 cubed is -8, and none when
it is even, since no real number squared is negative. The engine reads the power
as a fraction when it is written as one (`1/3`) or typed as a decimal (`0.2` is a
fifth), so an odd root answers, and an even one is refused by name rather than
answered with NaN (not a number).

```solve-doc
(-8)^(1/3) // -2
(-32)^0.2 // -2
(-8)^(2/3) // 4
(-1)^0.5 // ERROR: (-1)^0.5 has no real value: a negative number to a fractional power has one only when the fraction's denominator is odd, as in (-8)^(1/3).
```

The boundary: `^` stays in the real numbers. The square root of a negative
number has an exact complex answer, and `sqrt(-1)` gives it, `i`. A power that is
not a fraction at all, such as `log(2)`, has no real value on a negative number
either, and is refused the same way.

## Operators in words

Most operators have a word form, which is often how a line reads more naturally.

```solve
8 times 9 // 72
2 plus 3 // 5
5 minus 3 // 2
10 divide by 2 // 5
3 multiplied by 4 // 12
```

Multiplication and powers have the longer spellings people say aloud as well:
`times by` and `multiply by` are `*`, and `to the power of` is `^`.

```solve
6 times by 7 // 42
6 multiply by 7 // 42
2 to the power of 10 // 1,024
```

`with` adds and `without` subtracts, which reads well for a running total.

```solve
40 with 2 // 42
40 without 2 // 38
```

`add A to B` is the sum written as an instruction. Without its `to`, the word
`add` is the plus sign it always was. A `to` followed by a unit is still a
conversion, and `A to B` on its own, with no `add` in front, is the percentage
change from A to B (see [percentages](/syntax/percentages/)).

```solve
add 3 to 10 // 13
add $5 to $10 // $15.00
add 3 and 4 // 7
3 to 10 // 233.33%
```

`subtract A from B` is the difference written the same way, and takes A away
from B, in the order the sentence says. `take` and `remove` read the same.
Without a `from`, each of these words is the minus sign it always was.

```solve
subtract 3 from 10 // 7
take $5 from $20 // $15.00
subtract 3 km from 10 km // 7.00 km
subtract 3 // -3
```

The boundary: the `from` must stand at the top of the line, outside any
brackets, since a `from` inside them belongs to what is bracketed.

The words `mul`, `exponent` and `prime` are not operators. They were once
spellings of `*` and `^`, which made them unusable as names (even as
`:exponent`), so they are ordinary names now, and `7 is prime` asks whether 7 is
prime (see [number theory](/syntax/number-theory/)).

```solve-doc
exponent = 3 // 3
2 ^ exponent // 8
```

## Symbols pasted from elsewhere

A word processor, a chat client or a web page often replaces a typed hyphen
with a minus sign (`−`) or an en dash (`–`), and the multiplication and
division signs turn up in copied text and on some keyboards. Solve reads all
four as the operator they look like, so a line pasted from a document still
calculates.

```solve
10 − 3 // 7
10 – 3 // 7
3 × 4 // 12
12 ÷ 4 // 3
```

The mathematical symbols a phone keyboard or a pasted formula carries are read
too: `≤` and `≥` compare as `<=` and `>=` do, `√` is a square root, `∞` is
infinity and `π` is pi. The root binds as tightly as a minus sign, so `√16 + 9`
is the root of sixteen plus nine, and `2√3` is two times the root of three.

```solve
3 ≥ 2 // true
3 ≤ 2 // false
√16 + 9 // 13
√(9 + 16) // 5
2√3 // 3.46
2π // 6.28
1/∞ // 0
```

`π` is pi only while nothing in the note is named `π`, so a note that already
uses it as a variable keeps its own value. The word `infinity` is not read, since
it is ordinary English in a line of prose.

The em dash (`—`) is not an operator. It is a sentence mark, and a line that
carries one is read as prose.
