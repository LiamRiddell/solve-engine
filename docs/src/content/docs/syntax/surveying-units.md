---
title: "Surveying & older units"
description: Furlongs, chains, rods and other historic length and mass units.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Older units of length and mass still turn up on maps, in deeds and in trades:
the furlong and the chain from surveying, the hand for a horse's height, the
carat for a gemstone. Solve ships these so a figure quoted in one converts into
a modern unit without a lookup table.

```solve
1 furlong in m // 201.17 m
1 chain in m // 20.12 m
1 rod in m // 5.03 m
1 league in km // 4.83 km
1 hand in cm // 10.16 cm
1 mile in furlongs // 8.00 furlongs
```

A mil is a thousandth of an inch, which is small enough that a metric answer is
easier to read the other way round.

```solve
1 m in mil // 39,370.08 mil
```

Two mass units that often go missing. The carat is the metric one, exactly
200 mg, rather than the karat that grades gold. The centner is the metric
hundred kilograms, not the Imperial hundredweight, which is separately `cwt`.

```solve
1 carat in g // 0.20 g
1 centner in kg // 100.00 kg
```
