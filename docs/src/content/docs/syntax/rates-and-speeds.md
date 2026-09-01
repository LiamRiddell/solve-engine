---
title: "Rates & speeds"
description: Compound units written with a slash, and converting one rate into another.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A rate is one quantity measured per one of another: kilometres per hour, metres
per second, hours per day. It reads with a slash, the way it appears on a road
sign or a spec sheet, and Solve treats the whole compound as a single unit you
can write, convert and derive.

A unit written with a slash is a rate: a quantity per one of something. `km/h`,
`m/s` and `hours/day` are each one unit, not a division, so the compound spelling
you would read off a sign is what you can type.

```solve
100 km/h // 100.00 km/h
5 m/s // 5.00 m/s
3 hours / day // 3.00 hours/day
```

A rate converts to another rate, or to any of the single-word speed spellings
(`mph`, `kph`, `mps`), by converting the top and the bottom on their own.

```solve
100 km/h in mph // 62.14 mph
10 m/s in km/h // 36.00 km/h
60 mph in km/h // 96.56 km/h
100 km/h to m/s // 27.78 m/s
```

Dividing a distance by a time builds the same rate, and the conversion applies
to the whole quotient rather than to the number just before it.

```solve
120 km / 2 hours // 60.00 km/hours
120 km / 2 hours in kph // 60.00 kph
```

## Drive time

A distance *at* a speed is a duration: how long the journey takes. The answer
comes back in the largest sensible time unit.

```solve
250 miles at 60 mph // 4.17 h
100 km at 60 kph // 1.67 h
```

For a different unit, convert the whole thing: `(250 miles at 60 mph) in
minutes`. A quantity that is not a distance, so does not match the speed, is
reported as an error rather than a wrong number.
