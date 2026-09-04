---
title: "Timesheets"
description: Adding up worked hours, from clock times, spans and an hourly rate.
---

> **Package:** `TIME_PACKAGE`, with the hourly rate coming from `UOM_PACKAGE`. Both are registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

A timesheet is the same three sums every week. How long was each day, what do
they come to, and what is that worth.

## Adding the days up

A worked day is usually written the way a clock shows it, `8:15` for eight hours
and a quarter. Add them together and you get the week.

```solve
8:15 + 7:45 // 960 minutes
8:15 + 7:45 + 8:30 // 1,470 minutes
```

The total comes back in minutes, which is the unit every duration in the engine
is counted in, and `in hours` is how a timesheet usually wants to read it.

```solve
8:15 + 7:45 + 8:30 in hours // 24.50 hours
```

It is an ordinary duration once it is added up, so it goes on being one: more
time can be added to it, and it can be priced.

```solve
8:15 + 7:45 + 30 minutes // 990 minutes
8:15 + 7:45 at £15/hour // £240.00
```

## When a time is a time of day, not a length

`8:15` on its own is quarter past eight this morning, and it still is. It only
means eight and a quarter hours when it is added to another clock time, which is
the only reading that sum can have. Add a duration to it instead and it stays a
point in the day: `8:15 + 30 minutes` is quarter to nine this morning, a date and
a time, exactly as it was before any of this.

A time written with `am` or `pm` is a time of day and nothing else, so adding
two of those is refused rather than answered: `9am + 5:30pm` is not a length of
anything. Write the day as `8:15` if it is a stretch of time, and as `9am` if it
is a point in the day.

`-` between two clock times is left alone for the same reason the engine leaves
it alone elsewhere: `5pm - 7pm` reads as a range and `5pm - 2pm` as a
subtraction, and guessing between them would be worse than not answering.

## From clocking in to clocking out

If what you have is the two ends of the day rather than its length, `to` gives
the stretch between them.

```solve
9:00 to 17:30 // 510 minutes
9am to 5:30pm // 510 minutes
```

A shift that runs past midnight is the stretch it actually is, not a negative
number: the end is read as the next day.

```solve
9pm to 5am // 480 minutes
```

## What it pays

An hourly rate turns any of these into money. The duration does not have to be
in hours: the rate carries its own unit, so minutes and spans work too.

```solve
40 hours at £15/hour // £600.00
9:00 to 17:30 at £15/hour // £127.50
```

`per` reads the same as the slash, and the rate can be written either way round
for the currency you use.

```solve
9:00 to 17:30 at £15 per hour // £127.50
```
