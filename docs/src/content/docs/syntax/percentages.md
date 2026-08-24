---
title: Percentages
description: Percent of, increase and decrease, change between values, and solving for the base.
---

> **Package:** `PERCENTAGE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

```solve
50% of 200 // 100
10% of 250 // 25
```

## Increase and decrease

```solve
increase 100 by 10% // 110.00
```

## Successive change: up, down, then

Successive percentage changes compound, and this is the arithmetic people get
wrong most often. `up N%` and `down N%` apply a change to a value, and `then`
chains them so each change lands on the running total.

```solve
50 up 20% // 60
80 down 15% // 68
120 up 10% then down 10% // 118.80
```

The last line is the trap. It looks like it should return to 120, but the 10%
down comes off the larger 132, so the answer is 118.80. The unit rides along.

```solve
$300 up 10% then down 10% // $297.00
```

Repeat a step with `N times`, as a digit or a word.

```solve
100 up 10% three times // 133.10
```

## Change between two values

```solve
100 to 150 // 50.00%
```

## Solving for the base

When you know the percentage and the result but not the original.

```solve
5% of what is 6 // 120
```
