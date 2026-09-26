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

A ship's or an aircraft's speed is in knots: one nautical mile an hour, a little
faster than a mile an hour. It is written `kn`, `knot` or `knots`. `kt` is not the
knot, because the unit table already reads `kt` as the kilotonne.

```solve
20 knots in km/h // 37.04 km/h
20 kn in mph // 23.02 mph
1 knot in m/s // 0.51 m/s
```

Dividing a distance by a time builds the same rate, and the conversion applies
to the whole quotient rather than to the number just before it.

```solve
120 km / 2 hours // 60.00 km/hours
120 km / 2 hours in kph // 60.00 kph
```

## Speeds of rotation

An engine, a drill or a record player turns rather than travels, and its speed
is counted in revolutions per minute, `rpm` (or `RPM`, as a dashboard prints it).
One revolution is one full turn, so a turning speed is a frequency: how many times
a second something repeats, in hertz (`Hz`). 3,000 rpm is 50 turns a second.
A single revolution is an angle, written `revolution` or `revolutions`.

```solve
3000 rpm in Hz // 50.00 Hz
50 Hz in rpm // 3,000.00 rpm
1 revolution in deg // 360.00 deg
2 revolutions in rad // 12.57 rad
```

The boundary: the word `turn` is not read as a revolution, because it is ordinary
English (`take turns`, `turn 3 times`). A turning speed is a frequency rather
than a rate over a time, and a frequency and a time do not multiply here, so
`3000 rpm * 2 min` is refused rather than counted as 6,000 revolutions.

## Cancelling a rate

A rate multiplied by what it is per leaves the other half: a speed for a time is
a distance. Dividing a distance by a speed cancels the other way and leaves a
time. The single-word speeds cancel as the slash spellings do.
[Multiplying and dividing units](/syntax/unit-algebra/) has the full set,
prices and coverage rates included.

```solve
60 km/h * 2 h // 120.00 km
120 km / 60 km/h // 2.00 h
60 mph * 30 min // 30.00 mi
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
