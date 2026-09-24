---
title: Time
description: Clock times, durations, intervals, frame rates and timecode.
---

> **Package:** `TIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

## Clock times

| Expression | Result |
| --- | --- |
| `9:00am + 3 hours` | `12:00:00 PM` |
| `16:00` | a time value |

## Durations

A length of time, as opposed to a point in the day, is written as its parts.
Both spellings read the same, with the spaces or without, because a stopwatch, a
video player and most timers print the compact one and that is what gets pasted
in.

```solve
2h 30m // 150 minutes
2h30m // 150 minutes
1d6h // 30 hours
1h30m15s // 5,415 seconds
```

It is an ordinary quantity once read, so it converts like one.

```solve
1h30m in minutes // 90 minutes
```

The parts run from the larger unit to the smaller, which is what a duration
written this way means. That is also what makes it safe to read `m` as minutes
here: on its own, `m` is metres.

```solve
90m // 90.00 m
```

So `45m30s` is forty-five minutes and thirty seconds, because `s` follows it and
seconds are smaller than minutes, while `90m` on a line by itself is a distance.
Anything that does not descend is not a duration and is left alone: `2m30h` is
not two minutes and thirty hours, it is the undefined variable it always was.

## Intervals

```solve
7:30 to 20:45 // 795 minutes
```

Intervals crossing midnight are handled, so `4pm to 3am` is eleven hours rather
than a negative span.

Clock times added together are lengths rather than times of day, which is the
timesheet sum: `8:15 + 7:45 + 8:30` is the week so far. That, the span and the
hourly rate are on [timesheets](/syntax/timesheets/).

## Time zones

A time in another place, the same time in several places at once, the working
hours two or more places share, and a date read in a zone each have their own
page: see [time zones](/syntax/time-zones/).

## Frame rates and timecode

| Expression | Result |
| --- | --- |
| `30 fps` | a rate value |
| `01:02:03:04 at 30 fps` | a video timecode |
| `01:02:03:04 at 30 fps in frames` | the frame count |
