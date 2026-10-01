---
title: "Number bases"
description: Writing and showing numbers in hexadecimal, binary and octal.
---

> **Packages:** `ARITHMETIC_PACKAGE`, `FUNCTION_PACKAGE`, `CONVERTERS_PACKAGE`, `UOM_PACKAGE`, `BIGINT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

A base is the number of distinct digits a number is written with: everyday
decimal has ten, hexadecimal has sixteen, binary two, octal eight. The same
value can be written in any of them, mixed freely with ordinary decimals, and
shown back in whichever base you want.

## Writing a number in another base

A number in another base is written with a prefix that names the base: `0x` for
hexadecimal (the digits 0 to 9 and then A to F), `0b` for binary (only 0 and 1)
and `0o` for octal (0 to 7). Programmers meet these in colour codes, memory
addresses and file permissions; the engine reads each as the ordinary number it
stands for.

```solve
0xFF // 255
0b1010 // 10
0o17 // 15
0xDEADBEEF // 3,735,928,559
```

The prefix is case-insensitive and so are hex digits, so `0XFF`, `0xff` and
`0xFF` are the same number.

```solve
0xff // 255
0XFF // 255
```

A literal in any base is just a number, so bases mix in one expression and the
result comes back in decimal.

```solve
0xFF + 0b1010 + 0o17 // 280
0x1F + 1 // 32
```

## Showing a number in another base

`as` converts the display, and there is a function form for each base.

```solve
255 as hex // 0xFF
255 as binary // 0b11111111
255 as octal // 0o377
hex(4095) // 0xFFF
hex(255) // 0xFF
bin(10) // 0b1010
bin(5) // 0b101
```

`int` goes the other way, though a literal is already a number so it is rarely
needed.

```solve
int(0xFF) // 255
```

## A base is still a number

Converting a number to another base changes how it is written, not what it is,
so the result keeps doing arithmetic.

```solve
hex(255) + 1 // 256
(255 as binary) + 1 // 256
~hex(255) // -256
```

For the same reason, two numbers compare on their values whatever base each is
shown in. A conversion written on one side of a comparison belongs to that
side, so a line can put both sides into a base and still ask whether they are
equal, and a [check](/syntax/checks/) reads it the same way:

```solve
255 in hex == 0xff in hex // true
255 in binary == 0xff in octal // true
255 in hex == 256 in hex // false
check 255 in hex == 255 // ✓
```

A negative keeps its sign outside the literal, and a fraction is truncated,
since there is no useful way to write a fractional hex digit.

```solve
hex(-255) // -0xFF
255.7 as hex // 0xFF
```

A whole number too large for an ordinary number to hold exactly (past about
nine thousand million million, 2^53) keeps every digit when it is written in
another base, and when that base is converted on again. A chain of conversions
reads the digits the last one wrote, not a rounded copy, so the last digit of
2^100 + 1 survives a trip through binary into hex and back to a number:

```solve
(2^100 + 1) in binary as hex // 0x10000000000000000000000001
(2^100 + 1) in hex in octal // 0o2000000000000000000000000000000001
(2^100 + 1) in hex as number // 1,267,650,600,228,229,401,496,703,205,377
```

Arithmetic straight on such a number reads the same digits, so there is no
need to convert it back first. Adding, subtracting, multiplying, a remainder,
a power and a comparison all work on the whole number the base holds, and the
answer is an ordinary number, as `hex(255) + 1` is:

```solve
(2^100 + 1) in hex + 1 // 1,267,650,600,228,229,401,496,703,205,378
(2^100 + 1) in hex * 2 // 2,535,301,200,456,458,802,993,406,410,754
((2^100 + 1) in hex) mod 10 // 7
((2^100 + 1) in hex) > 2^100 // true
```

### What has no digits

An infinity, such as `1/0`, has no digits in any base, so writing one in hex,
binary or octal is refused rather than shown as the word "Infinity". The same
goes for an ordinary number past about 1.8e308 (the largest an ordinary number
holds), such as `2^4000`: it is already infinite before it reaches the
conversion. A whole number written with `n` has no such ceiling, up to its own
[size limit](/syntax/big-integers/), so `2n^4000` is the way to write one out
in full:

```solve
(1/0) in hex // An infinite value has no digits to write in hex. An ordinary number past about 1.8e308 is infinite; a whole number written with n, as in 2n^4000, keeps every digit.
2^4000 in binary as hex // An infinite value has no digits to write in binary. An ordinary number past about 1.8e308 is infinite; a whole number written with n, as in 2n^4000, keeps every digit.
2n^200 in hex // 0x100000000000000000000000000000000000000000000000000
```

The boundary. Arithmetic keeps a base's whole number exact against a plain
number or another base. Against a quantity, a percentage or a measurement with
a tolerance it is read as the nearest ordinary number, as any large number is
there. A division that does not come out whole is shown as an ordinary number,
though `as fraction` still gives it exactly, and a power past about 1.8e308 is
infinite, as it is for any ordinary number. A base holding an `n` number past
1.8e308 adds, subtracts, multiplies and takes a remainder as the `n` number it
is, and divides and raises as an ordinary number would.
