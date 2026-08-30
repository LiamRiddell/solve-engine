---
title: "Bit shifting"
description: Shifting the bits of an integer left or right.
---

> **Packages:** `ARITHMETIC_PACKAGE`, `FUNCTION_PACKAGE`, `CONVERTERS_PACKAGE`, `UOM_PACKAGE`, `BIGINT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

A shift slides the binary digits of a whole number sideways: left to make it
bigger, right to make it smaller, each place a doubling or a halving. It is a
low-level operation programmers reach for, and Solve writes it the way C and its
relatives do.

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
negative. `>>>` fills with zeros instead, which turns a negative into a large
positive one.

```solve
-16 >> 2 // -4
-1 >> 1 // -1
-8 >>> 1 // 2,147,483,644
```

The two agree on anything non-negative, so the difference only shows up on the
sign bit.

```solve
8 >> 1 // 4
8 >>> 1 // 4
```
