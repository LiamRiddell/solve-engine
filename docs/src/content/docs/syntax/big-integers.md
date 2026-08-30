---
title: "Big integers"
description: Keeping full precision on integers beyond the ordinary safe range.
---

> **Package:** `BIGINT_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

An ordinary number loses precision once it grows past a certain size, and bitwise
work is limited to a 32-bit range. A big integer sidesteps both: suffix an
integer with `n` and it is held as a whole number of any size, exactly.

Suffix an integer with `n` to keep full precision beyond the safe range for
ordinary numbers, and for bitwise work that overflows the 32-bit range and needs
ordinary integer arithmetic instead.

```solve
123n * 2 // 246
```
