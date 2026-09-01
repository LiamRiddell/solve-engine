---
title: "Comparison shopping"
description: Which is cheaper, and by how much, with vs.
---

> **Package:** `SHOPPING_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

The shop-shelf question is which of two things is the better value. The maths for
each side is already ordinary arithmetic: a stacked discount is `£80 - 20% - 10%`,
and a per-unit price is a division, so `£3 / 500g` is the price per gram. `vs`
adds the missing piece, putting two of them side by side.

```solve
£3 / 500g vs £4 / 750g // the second is cheaper, 11% less
£3 vs £4 // the first is cheaper, 25% less
```

Lower is cheaper, and the two sides have to be the same kind of thing: a price
against a price, a per-gram rate against a per-gram rate. A price against a
weight is reported as an error rather than a meaningless answer. `versus` is an
alias, and two equal amounts read as `the same`.
