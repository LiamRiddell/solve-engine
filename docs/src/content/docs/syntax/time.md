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
or the twenty-four-hour form. It is read as that time today, so adding a length
of time moves it forward and the answer is a date and a time. The answers shown
are for Wednesday 11 March 2026 in London, the fixed date these pages are
checked against; the notepad uses your own today.

```solve
9:00am + 3 hours // Wednesday, March 11, 2026, 12:00:00 PM
16:00 // Wednesday, March 11, 2026, 4:00:00 PM
3.30pm // Wednesday, March 11, 2026, 3:30:00 PM
```

The minutes may follow a point instead of a colon, as British timetables write
them, so `3.30pm` is `3:30pm`. Only two digits after the point are minutes:
`3.5pm` could mean half past or five past, so it is not read as a time at all.

Either side of a colon is a whole number of hours or minutes, so a decimal
beside a colon is not a time, and the line says so rather than reading the
whole part alone:

```solve-doc
1:30 // Wednesday, March 11, 2026, 1:30:00 AM
1.5:3 // ERROR: "1.5:3" is not a valid time
```

A clock shows hours from 0 to 23 and minutes from 0 to 59, so a colon pair
outside those (`24:00` for the end of a day, `9:60` as a slip of the finger) is
no time any clock can show. It is refused by name, in the same words, whether it
stands on its own line, in a sum, or inside brackets, a function call or a list.
A third field after the minutes is seconds, which also run from 0 to 59, so
`1:23:99` is refused the same way:

```solve-doc
24:00 // ERROR: "24:00" is not a valid time
1 + 24:00 // ERROR: "24:00" is not a valid time
1:23:99 // ERROR: "1:23:99" is not a valid time
(24:00) // ERROR: "24:00" is not a valid time
max(9:60, 10:15) // ERROR: "9:60" is not a valid time
total(24:00, 0:00) // ERROR: "24:00" is not a valid time
```

Earlier versions read the text before such a colon as a
[label](/syntax/labels/), so `1 + 24:00` answered 0 and `1:23:99` answered 99.

Midnight at the start of the day is `0:00`, and the last minute is `23:59`. The
one place a colon between two numbers is not a time is the list that `sum`,
`prod`, `map` or `reduce` works through, where `sum(24:30)` is the range of whole
numbers from 24 to 30 (see [map, reduce and aggregates](/syntax/map-reduce-and-aggregates/)).

A clock time is shown as the full date and time, not as the time of day alone.

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

`as timespan` writes a length of time back out in words, largest unit first,
which reads better than a large count of one unit:

```solve
5415 seconds as timespan // 1 hour 30 minutes 15 seconds
2h30m as timespan // 2 hours 30 minutes
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
$15/hr // $15.00/hr
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
$15/hr // $15.00/hr
```

`m` is still metres outside a compact duration, as above.

### ISO 8601 durations

Software writes a length of time in a fixed form set by the ISO 8601 standard,
and that is what an API response, a log line or a calendar file hands you: a
`P` (for period), the date parts, then a `T` (for time) and the time parts, each
a number and a letter. `PT1H30M` is one hour and thirty minutes, `P1D` is one
day. The letters are `Y` years, `M` months, `W` weeks and `D` days before the
`T`, and `H` hours, `M` minutes and `S` seconds after it, which is why the `T`
is there: `M` is months on one side of it and minutes on the other. Pasted into
a line, it reads as the length it writes, the same quantity the compact spelling
above builds.

```solve
PT1H30M // 90 minutes
P1D // 1 day
P2W // 2 weeks
PT0.5S // 0.50 seconds
PT1H30M in minutes // 90 minutes
```

The last part written may carry a fraction, with a point or a comma as the
standard allows (`PT0,5H` is half an hour). Several parts are added up and held
in the smallest unit written, as `1h30m` is, and the parts must run from the
largest to the smallest, each once.

Added to or taken from a date, the parts are applied one at a time, largest
first, which is what the standard means and what calendar software does. A
month moves the month on the calendar (January 31 plus a month is February 28,
the last day the month has) and a day then moves the day, so the answer is the
date a person counting on a calendar would reach.

```solve
2026-01-31 + P1M1D // Sunday, March 1, 2026
2026-01-01 + P1Y2M10DT2H30M // Thursday, March 11, 2027, 2:30:00 AM
2026-03-31 - P1M // Saturday, February 28, 2026
```

`as iso8601` writes a length of time back in the same form, so a result can be
pasted into a form or a file that expects one. The parts follow the unit the
value is held in, so the text reads back in as the same length: years as years,
months as months, days and weeks as days, and anything shorter as hours,
minutes and seconds (26 hours stays `PT26H`, since a calendar day is not always
24 hours long).

```solve
90 minutes as iso8601 // PT1H30M
1.5 days as iso8601 // P1DT12H
14 months as iso8601 // P14M
26 hours as iso8601 // PT26H
```

A spelling that is shaped like a duration but breaks the rules is refused by
name rather than read as a name nobody defined. `P1H` puts a time part before
the `T`; `P1D1D` repeats a part; `P.5D` has no digit before its decimal mark,
which the standard requires (`P0.5D` is half a day).

```solve-doc
P1H // ERROR: P1H is not an ISO 8601 duration: H is a time part, and time parts come after a T, as in PT1H.
P1D1D // ERROR: P1D1D is not an ISO 8601 duration: 1D is out of place: the parts run from the largest to the smallest, each once.
P.5D // ERROR: P.5D is not an ISO 8601 duration: a decimal mark needs a digit before it, as in P0.5D.
```

The boundary: only the upper-case letters the standard uses are read, and only
when the whole name matches, so `pt1h30m` stays a name, and so do `P`, `PT` and
`P1`, which spell no part. A variable you named with a duration's spelling, such
as `P1D`, is read as the duration instead. Years and months keep the lengths the
unit table gives them when the duration is not added straight to a date: `P1M in
days` is 30 days, as `1 month in days` is, and a duration held in a variable is
one length at those sizes, so add it to the date directly to move by calendar
months.

```solve
P1M in days // 30 days
```

## Intervals

```solve
7:30 to 20:45 // 795 minutes
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
seconds (frames count from zero). A timecode answers in the notation it was
written in, with its rate, so the answer can be read back in as the same
timecode.

```solve
30 fps // 30.00 frames/s
01:02:03:04 at 30 fps // 01:02:03:04 at 30 fps
01:02:03:04 @ 25 fps // 01:02:03:04 at 25 fps
```

Adding a number moves a timecode on by that many frames, and the seconds and
minutes carry as a clock's do. A length of time is added at the timecode's own
rate, and the difference between two timecodes is the number of frames between
them.

```solve
01:02:03:04 at 30 fps + 10 // 01:02:03:14 at 30 fps
00:00:00:29 at 30 fps + 1 frames // 00:00:01:00 at 30 fps
01:02:03:04 at 30 fps + 2 seconds // 01:02:05:04 at 30 fps
01:02:03:04 at 30 fps - 01:02:03:00 at 30 fps // 4.00 frames
```

Editing software and edit lists work in frame counts, so a timecode converts to
one with `in frames`, and a frame count at a rate is the timecode it reaches. It
also converts to a length of time: its frames over its rate.

```solve
01:02:03:04 at 30 fps in frames // 111,694.00 frames
111694 frames at 30 fps // 01:02:03:04 at 30 fps
00:00:01:15 at 30 fps in seconds // 1.50 seconds
01:02:03:04 at 30 fps as timespan // 1 hour 2 minutes 3.133 seconds
```

A timecode moved back past zero is shown with a minus sign, and a count that is
not a whole number of frames (half a second at 25 fps is twelve and a half
frames) is shown as the count, since no frame field could hold it.

```solve
00:00:00:00 at 30 fps - 10 // -00:00:00:10 at 30 fps
00:00:00:00 at 25 fps + 0.5 seconds // 12.5 frames at 25 fps
```

The boundary: two timecodes at different rates are not combined, since a frame
at one rate is not a frame at the other, and a timecode is multiplied or divided
only by a plain number. The count is plain timecode: the drop-frame form
broadcast video uses at 29.97 fps is not implemented, so at that rate the fields
count thirty frames a second and the length in seconds is the real time those
frames take.
