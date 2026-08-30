---
title: "Named derived units"
description: Multiplying quantities into a named physical unit like the newton, watt or joule.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Many physical quantities are built from simpler ones multiplied together: a force
is a mass times an acceleration, energy is a force times a distance. When you
multiply two quantities and the combination is one of these named quantities, the
engine recognises it and shows the answer under its proper name.

Many physical quantities are really other quantities multiplied together. A
**force** is a mass times an acceleration; **power** is voltage times current;
**energy** is power times time, or a force times a distance. When you multiply
two quantities, the engine tracks what their units combine into, and when the
result is one of these named quantities, it shows it by its name:

```solve
70 kg * 9.81 m/s^2 as N // 686.70 N
230 V * 13 A as W // 2990.00 W
50 N * 4 m as J // 200.00 J
2000 W * 3 hours as kWh // 6.00 kWh
```

`N` is the newton (force), `W` the watt (power), `J` the joule (energy), and
`kWh` the kilowatt-hour (energy again, the unit an electricity bill uses).
Writing `as N` asks for the answer in that unit; the engine also names the result
on its own when you leave the `as` off. This works only where the combination
makes a named quantity: `5 m * 3 m` is an area and stays as it was, and
multiplying two unrelated quantities is still reported as a mismatch rather than
invented into a unit. (A fuller algebra of units, and units raised to arbitrary
powers, are a later addition.)
