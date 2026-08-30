---
title: "Number bases"
description: Writing and showing numbers in hexadecimal, binary and octal.
---

> **Packages:** `ARITHMETIC_PACKAGE`, `FUNCTION_PACKAGE`, `CONVERTERS_PACKAGE`, `UOM_PACKAGE`, `BIGINT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

A base is the number of distinct digits a number is written with: everyday
decimal has ten, hexadecimal has sixteen, binary two, octal eight. The same
value can be written in any of them, and shown back in whichever you want.
Numbers can be written in hexadecimal, binary or octal, mixed freely with
ordinary decimals, and shown back in whichever base you want.

## Writing a number in another base

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

A negative keeps its sign outside the literal, and a fraction is truncated,
since there is no useful way to write a fractional hex digit.

```solve
hex(-255) // -0xFF
255.7 as hex // 0xFF
```
