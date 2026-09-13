---
title: "Number suffixes"
description: Shorthand letters for thousands, millions, billions and trillions.
---

> **Package:** `ARITHMETIC_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A suffix is a single letter that stands in for a run of zeros, so a large round
number can be written the short way people say it: `k` for thousand, `M` for
million, `B` (or `G`) for billion, and `T` for trillion. The letter attaches to
the number: `2.5k` is 2,500, but `2.5 k` with a space reads `k` as an ordinary
name.

```solve
2.5k // 2,500
3M // 3,000,000
5B // 5,000,000,000
2T // 2,000,000,000,000
```
