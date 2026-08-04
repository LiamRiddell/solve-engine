---
title: Programmer math
description: Hexadecimal, binary and octal literals, base conversion, bit shifts and bitwise operators.
---

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
bin(10) // 0b1010
```

`int` goes the other way, though a literal is already a number so it is rarely
needed.

```solve
int(0xFF) // 255
```

## Shifting

`<<` and `>>` shift left and right.

```solve
1 << 8 // 256
1 << 10 // 1,024
256 >> 4 // 16
```

Shifts work on 32-bit signed integers, which is worth knowing at the edges. The
shift count is taken modulo 32, so shifting by 32 shifts by nothing at all, and
bit 31 is the sign bit.

```solve
1 << 31 // -2,147,483,648
1 << 32 // 1
```

`>>` keeps the sign rather than filling with zeros, so a negative number stays
negative.

```solve
-16 >> 2 // -4
-1 >> 1 // -1
```

## Bitwise operators

`&` and `|` are and and or. Exclusive or is the word `xor`.

```solve
0xFF & 0x0F // 15
0xF0 | 0x0F // 255
0xFF xor 0x0F // 240
0b1010 & 0b0110 // 2
0b1010 | 0b0110 // 14
0b1010 xor 0b0110 // 12
```

Exclusive or is a word because `^` is already exponentiation, which is the far
more common thing to want on a page of sums. `2^10` is a thousand and change,
not three.

```solve
2^10 // 1,024
```

## Parenthesise anything mixed

This is the one thing to be careful about. These operators do not follow the
precedence order that C, JavaScript, Python and their relatives share, so an
expression that mixes them without brackets will not always mean what you
expect. `|` binds tighter than `<<` here, where in C it is the other way round.

```solve
1 | 2 << 3 // 24
(1 | 2) << 3 // 24
1 | (2 << 3) // 17
```

The last line is what a C programmer reads the first line as. Bracket anything
that mixes a shift with a bitwise operator and the ambiguity goes away.

```solve
(0xF0 | 0x0F) & 0xFF // 255
(1 << 8) | 1 // 257
```

## Data sizes

Byte and bit units are ordinary units, so they convert like any other
measurement. Decimal and binary prefixes are both there and are kept distinct:
`kB` is 1,000 bytes and `KiB` is 1,024.

```solve
1 kB in bytes // 1000.00 bytes
1 KiB in bytes // 1024.00 bytes
1 GB in MB // 1000.00 MB
1 TiB in GiB // 1024.00 GiB
1 byte in bits // 8.00 bits
1.5 MB in KB // 1500.00 KB
```

Case matters, and it matters more here than almost anywhere: `MB` is megabytes
and `Mb` is megabits, a factor of eight apart.

```solve
1 GB in bits // 8000000000.00 bits
1 Gb in Mb // 1000.00 Mb
```

See [units and conversions](/syntax/units-and-conversions/) for the full list.

## Big integers

Bitwise work that overflows the 32-bit range needs ordinary integer arithmetic
instead. Suffix an integer with `n` to keep full precision.

```solve
123n * 2 // 246
```

## What is not here

There is no bitwise NOT and no unsigned right shift (`>>>`). Both are the usual
companions to the operators above, and neither is currently reachable.

Note also that `and` is not a bitwise operator. It is the plain English word,
and it adds.

```solve
5 and 3 // 8
```
