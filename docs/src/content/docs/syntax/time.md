---
title: Time
description: Clock times, durations, intervals, frame rates and timecode.
---

> **Package:** `TIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Time comes in two kinds, and this page covers both: a point in the day, such as
half past three, and a length of time, such as two and a half hours. It also
covers the gap between two clock times, and the frame rates and timecode that
video uses.

## Clock times

A clock time is a point in the day, in the twelve-hour form with `am` or `pm`
or the twenty-four-hour form. It is shown as a time of day, and adding a length
of time moves it forward to another.

```solve
9:00am + 3 hours // 12:00:00 PM
16:00 // 4:00:00 PM
3.30pm // 3:30:00 PM
```

The minutes may follow a point instead of a colon, as British timetables write
them, so `3.30pm` is `3:30pm`. Only two digits after the point are minutes:
`3.5pm` could mean half past or five past, so it is not read as a time at all.

A clock time is read as that time today. When adding or taking away a length of
time carries it past midnight, the answer says how many days it has moved, the
way the time-zone forms do:

```solve
11pm + 2 hours // 1:00:00 AM (+1 day)
1am - 2 hours // 11:00:00 PM (-1 day)
```

To show any other date and time as the time of day alone, write it `as time`.
The moment does not change, only how it is shown:

```solve
2026-04-03T09:30 as time // 9:30:00 AM
```

`as time` takes a date. A plain number has no time of day of its own, so it is
refused rather than read as a moment in 1970; to show a Unix timestamp's time,
read it as a date first, `1710000000 as date as time` (see
[timestamps](/syntax/timestamps/)). The gap between two clock times is a length
of time, not a time of day, so `5pm - 9am` is `8:00` and `9am to 5pm` is 480
minutes, as before.

`noon` and `midnight` are the clock times 12:00 and 0:00, the same as `12pm`
and `12am`, and work anywhere a clock time does. `midnight` is the start of
today, not the end of it.

```solve
noon // 12:00:00 PM
noon + 90 minutes // 1:30:00 PM
midnight // 12:00:00 AM
```

Because `noon` and `midnight` are now read as times, a variable with either
name is read with its colon, `:noon`, as any name the engine also reads as a
word is. Assigning one (`noon = 12`) still works.

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

### Short spellings

The abbreviations people write after a number are units in their own right, not
only inside a compact duration: `hr` and `hrs` for hours, `mins` for minutes,
`sec` and `secs` for seconds, `wks` for weeks and `yrs` for years, beside the
`h`, `min`, `s`, `wk` and `yr` that were always there. So an hourly rate reads
the way a payslip writes it, and a meeting the way a calendar does.

```solve
$15/hr // 15.00 USD/hr
30 mins // 30.00 mins
$15/hr * 37.5 hrs // $562.50
2 hours in mins // 120.00 mins
90 minutes in hr // 1.50 hr
```

Each is another name for a unit the engine already had, so `hr` is exactly an
hour and converts and combines as `h` does. Like every unit spelling it is lower
case only (`HR` is a name), and it is a unit where a unit belongs, straight after
a number. A variable called `hr` is still your variable at the start of a line
or after an operator, as [variables](/syntax/variables/) explains, while `$15/hr`
stays an hourly rate whatever `hr` holds, just as `$15/h` always did.

```solve-doc
hr = 2
hr * 3 // 6
$15/hr // 15.00 USD/hr
```

`m` is still metres outside a compact duration, as above.

## Intervals

The gap between two clock times is written with `to` or `until`, and the
answer is its length.

```solve
7:30 to 20:45 // 795 minutes
9am until 5pm // 480 minutes
9am to noon // 180 minutes
```

Intervals crossing midnight are handled, so `4pm to 3am` is eleven hours rather
than a negative span.

```solve
4pm to 3am // 660 minutes
```

Clock times added together are lengths rather than times of day, which is the
timesheet sum: `8:15 + 7:45 + 8:30` is the week so far. That, the span and the
hourly rate are on [timesheets](/syntax/timesheets/).

## Time zones

A time in another place, the same time in several places at once, the working
hours two or more places share, and a date read in a zone each have their own
page: see [time zones](/syntax/time-zones/).

## Frame rates and timecode

Video is a run of still frames, shown at a frame rate such as 30 frames per
second (`30 fps`). A timecode names one frame by where it falls: hours,
minutes, seconds and then the frame within that second, so `01:02:03:04` at
30 fps is the fifth frame of the second at one hour, two minutes and three
seconds (frames count from zero). Editing software and edit lists work in
frame counts, which is why a timecode is converted to one.

```solve
30 fps // 30.00 frames/s
01:02:03:04 at 30 fps in frames // 111,694.00 frames
111694 frames at 30 fps // 01:02:03:04
```

A timecode on its own is shown as its frame count labelled with its rate, not yet
in the notation it was written in. The count is plain timecode: the drop-frame
form broadcast video uses at 29.97 fps is not implemented.

```solve
01:02:03:04 at 30 fps // 111,694.00 timecode@30
```
