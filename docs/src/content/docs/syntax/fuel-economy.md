---
title: "Fuel economy"
description: Converting between miles per gallon and litres per 100 km, which run opposite ways.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Fuel economy says how far a vehicle goes on a given amount of fuel. It is written
two ways that measure the same thing from opposite ends, and converting between
them is not a plain rescale, so the engine handles the turn for you.

Fuel economy is written two ways that mean the same thing: **miles per gallon**
(`mpg`), where a bigger number is better, and **litres per 100 km** (`l/100km`),
where a smaller number is better. One is distance per fuel, the other fuel per
distance, so they are opposites of each other, and converting between them means
taking one over the other, not just rescaling. That is why it needs its own
step, and it is done for you:

```solve
40 mpg in l/100km // 5.88 l/100km
6 l/100km in mpg // 39.20 mpg
30 mpg in km/l // 12.75 km/l
```

`mpg` is miles per US gallon (the gallon the engine ships). Going between two
distance-per-fuel forms, `mpg` and `km/l`, is an ordinary rescale, since both
count the same way up; it is only the mpg-to-`l/100km` pairing that turns over.
