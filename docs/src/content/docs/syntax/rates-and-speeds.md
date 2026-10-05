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

A knot is a rate, so a speed in knots times a time cancels the hours and
leaves the distance covered, in nautical miles.

```solve
10 knots * 2 hours // 20.00 nmi
```

The target can be written the way the rate itself can, with `per` in place of
the slash, and a price with its currency symbol. `in miles per hour` is the same
target as `in miles/hour`, and `in $/day` the same as `in USD/day`, so a speed
or a pay rate reads the same on both sides of `in`.

```solve
60 km/h in miles per hour // 37.28 miles/hour
60 km/h to miles per hour // 37.28 miles/hour
$20/hour in $/day // $480.00/day
$20/hour in dollars per day // $480.00/day
$20 per hour in USD per day // $480.00/day
100 Mbps in MB per s // 12.50 MB/s
```

A target of a bare slash and a unit keeps what the rate counts and changes only
what it is per, so a weekly amount reads as a monthly one. A frequency, which is
a count per second, converts to a count per any time.

```solve
$50/week in /month // $214.29/month
60 mph in /min // 1.00 mi/min
10 Hz in /min // 600.00 /min
```

A price per hour in another currency per day converts through the exchange rate
once one is known, and until then says the rate is missing. `in $` on its own is
still a currency conversion, and only `per` and the slash are read in a target:
after a conversion, `a` and `each` stay prose, so `100 km in miles a day` is a
distance converted and then made a rate. A target that is not a rate of the
same kind is refused, as `5 km in miles per hour` is: a distance is not a speed.

```solve-doc
$20 in $ // $20.00
100 km in miles a day // 62.14 miles/day
5 km in miles per hour // ERROR: Cannot convert km to miles/hour: they do not measure the same thing
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

## Adding and comparing rates

Two rates of the same kind are one quantity written in two units, so they add,
subtract and compare the way two lengths do. The right-hand rate is read in the
left-hand one's unit first, by the same conversion `in` makes, and the answer is
in the left-hand unit. A total of rates works the same way.

```solve
10 m/s + 36 km/h // 20.00 m/s
10 km/h + 5 mph // 18.05 km/h
10 m/s > 30 km/h // true
total of 10 m/s, 36 km/h // 20.00 m/s
```

The boundary: two rates of different kinds do not combine, since a speed and a
flow of mass per second are not one quantity. Two prices per hour in different
currencies are not converted at an exchange rate here either.

```solve
10 m/s + 5 kg/s // Cannot combine incompatible units: m/s and kg/s
```

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
