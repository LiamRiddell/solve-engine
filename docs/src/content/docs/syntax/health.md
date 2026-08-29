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
