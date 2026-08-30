---
title: "Converting units"
description: Turning a quantity from one unit into another with to, in and into.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Converting a quantity means writing the same amount in a different unit: five
kilometres as miles, a hundred centimetres as metres, a temperature in Celsius
as Fahrenheit. The amount does not change, only the unit it is expressed in.

`to`, `in` and `into` all convert.

```solve
5 km to miles // 3.11 miles
100 cm into m // 1.00 m
1 hour to minutes // 60 minutes
72F to C // 22.22 C
20C in F // 68.00 F
```

A conversion between two different dimensions has no answer, so it is refused
rather than guessed. The message names the dimensions rather than the units, so
`1 hour in metres` reports *a duration cannot be converted to a length* and
`5 kg in m` reports *a mass cannot be converted to a length*. Combining two
different dimensions is refused the same way: `5 kg + 3 m` reports *mass and
length cannot be added*.
