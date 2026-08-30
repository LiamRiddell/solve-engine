---
title: "Decimals"
description: How a number with a decimal point is held, and where exactness applies.
---

> **Package:** `ARITHMETIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A decimal is a number written with a point, like `0.1`. How it is stored decides
whether small rounding errors creep in, so it is worth knowing which numbers are
kept exact and which are not.

A number written with a decimal point is an ordinary IEEE floating-point value,
so `0.1 + 0.2` is the usual `0.30000000000000004` and transcendental work stays
in floating point where it belongs. Money is the exception: amounts in a
currency are held as exact decimals, so `$0.10 + $0.20` is `$0.30`. See
[money precision](/syntax/money-precision/) for what that covers.
