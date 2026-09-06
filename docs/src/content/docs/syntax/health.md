---
title: Health & fitness
description: "Body mass index, and the pace or speed of a run from its distance and time."
---

> **Package:** `HEALTH_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A few everyday health and fitness sums. They are written as functions, with the
numbers in the units the labels state.

## Body mass index

`bmi(weight, height)` is the body mass index, weight in kilograms over height in
metres squared, the standard rough measure of build.

```solve
bmi(70, 1.75) // 22.86
```

## Pace and speed

For a run or a ride, `pace` and `speed` are the two ways of reading the same
effort: `pace` is the time to cover one kilometre (minutes and seconds), and
`speed` is the distance covered in an hour. Both take the distance in kilometres
and the time in minutes.

```solve
pace(10, 50) // 5:00 /km
speed(10, 50) // 12.00 km/h
pace(21.1, 100) // 4:44 /km
```

The last line is a half marathon (21.1 km) in one hour forty, a pace of four
minutes and forty-four seconds per kilometre.

## Writing a pace directly

A pace can also be written the way it appears on a watch, as minutes and seconds
over a distance. It is an ordinary quantity once written, so it converts and it
multiplies out.

```solve
4:30/km // 4:30 /km
4:30/km in min/mi // 7:15 /mi
10 km at 4:30/km as laptime // 00:45:00
42.2 km at 4:30/km as laptime // 03:09:54
```

The last line is a marathon at four and a half minutes a kilometre, three hours
nine minutes and fifty-four seconds.

`4m30s/km` says the same thing and always did; the two are the same quantity and
display alike. An hour or more per unit shows the hours:

```solve
1:30:00/km // 1:30:00 /km
```

### What makes it a pace

The distance does. A pace is a time over a length, so the unit after the slash is
what decides, and that is what keeps every other reading of a clock literal
intact: `4:30` on its own is still half past four in the morning, `8:15 + 7:45`
is still sixteen hours, and `90 km/h` is a speed rather than a pace because it is
a distance over a time.

The boundary is a pace faster than a minute per unit. A clock shows whole
seconds, and rounding one that fast would change the number, so it keeps its
digits: a swim written `1:30/100m` reads as `0.90 seconds/m`, because the
denominator reduces to a single metre.
