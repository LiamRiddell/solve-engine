---
title: "Date differences"
description: The span between two dates, or the time until or since one.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A date difference measures the span between two dates, in whichever unit you
ask for, or the time until or since a single date reckoned from now. The
`between` of two fixed dates is proven here; a duration to or from now moves
with the day.

A `between` of two fixed dates is proven; a duration to or from now moves with
the day.

```solve
weeks between 01/01/2024 and 01/06/2024 // 21.71 weeks
```

```solve
days until 25/12/2026
days since 01/01/2023
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
mondays until 25/12/2026
sundays since 01/01/2026
```

### Both ends are included

A range written to a Friday was written to include it, so a Friday on either
endpoint is counted. It follows that a single day counts as one if it is that
weekday and none if it is not, and that `fridays until` a Friday counts today.

It counts calendar weekdays and does not consult a holiday calendar, because a
Friday that is a public holiday is still a Friday. `working days between` is the
form that skips holidays, and it already exists: see
[working days](/syntax/working-days/).
