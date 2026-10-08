---
title: "Date differences"
description: The span between two dates, or the time until or since one.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A date difference measures the span between two dates, in whichever unit you
ask for, or the time until or since a single date reckoned from now.

A duration to or from now moves with the day. The answers shown for those are
for noon on Wednesday 11 March 2026 in London, the fixed moment these pages are checked against, and the notepad gives yours.
A count from today includes the part of today already gone, so at noon it ends
in a half. An app that starts relative days at midnight counts whole days
instead, 289 rather than 288.50 (see
[counting from the start of the day](/syntax/relative-dates/#counting-from-the-start-of-the-day)).

```solve
weeks between 01/01/2024 and 01/06/2024 // 21.71 weeks
```

```solve
days until 25/12/2026 // 288.50 days
days since 01/01/2023 // 1,165.50 days
```

## Subtracting one date from another

Taking one date away from another gives the number of days between them,
which is what the question usually is: how long until the holiday, how many
days a booking runs. A later date taken from an earlier one gives a negative
count, and the answer converts like any length of time.

```solve
25/12/2026 - 24/12/2026 // 1 day
2026-12-25 - 2026-01-01 // 358 days
24/12/2026 - 25/12/2026 // -1 day
(2026-12-25 - 2026-01-01) in weeks // 51.14 weeks
```

The days are counted on the calendar, as `days between` counts them, so a day
the clocks change in still counts as one: `31/03/2024 - 30/03/2024` is 1 day,
though that day in London was 23 hours long. A difference added back to a date
moves it by those days.

```solve
31/03/2024 - 30/03/2024 // 1 day
2026-12-24 + (2026-12-25 - 2026-12-24) // Friday, December 25, 2026
```

The boundary: when either side has a time of day, the answer is the time that
passed, on a clock, since a time in the question asks for the hours.

```solve
2026-12-25 09:00 - 2026-12-24 // 33:00
```

## Counting a weekday

`fridays between` two dates counts how many Fridays fall in the range, which is
a different question from how many weeks it spans. Every weekday name works, in
the plural a person counting would write or in the singular, and a leading `how
many` reads the same.

```solve
fridays between 01/06/2026 and 31/08/2026 // 13
how many fridays between 01/06/2026 and 31/08/2026 // 13
mondays between 01/06/2026 and 31/08/2026 // 14
weeks between 01/06/2026 and 31/08/2026 // 13 weeks
```

Those three ranges are the same three months. It holds fourteen Mondays and
thirteen of everything else, because 1 June 2026 and 31 August 2026 are both
Mondays, which is the part `weeks between` cannot tell you: it answers thirteen
whichever weekday you meant.

`until` and `since` count against today rather than a second date.

```solve
mondays until 25/12/2026 // 41
sundays since 01/01/2026 // 10
```

### Both ends are included

A range written to a Friday was written to include it, so a Friday on either
endpoint is counted. It follows that a single day counts as one if it is that
weekday and none if it is not, and that `fridays until` a Friday counts today.

It counts calendar weekdays and does not consult a holiday calendar, because a
Friday that is a public holiday is still a Friday. `working days between` is the
form that skips holidays, and it already exists: see
[working days](/syntax/working-days/).
