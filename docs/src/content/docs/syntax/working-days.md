---
title: "Working days"
description: Counting days that skip weekends, and public holidays when supplied.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A working day is a weekday, a day an office is open, so a deadline measured in
working days skips the weekends in between. Solve counts them forward or back
from a date, or across a window, and excludes public holidays too when the host
supplies a calendar.

Deadlines count working days, not calendar days. Weekends are always skipped.
An offset counts forward or back to a working day, and `between` counts the
working days in a window, both ends included.

```solve
25/12/2023 + 5 workdays // Monday, January 1, 2024
working days between 01/01/2024 and 31/01/2024 // 23
workdays in 3 weeks // 15
```

```solve
3 business days from today
```

`working` and `business` days mean the same thing, and either reads in the
singular for a count of one (`1 working day after ...`).

## Public holidays

Holidays cannot be worked out from a date the way a weekend can: they depend on
the region and change year to year. So the engine excludes them only when the
host application supplies a calendar, the same way it takes a data source for
stocks or weather. Left unconfigured, working-day arithmetic skips weekends
only, and says as much rather than guessing a holiday it was never told about.

A host passes the calendar as a list of dates or a predicate function:

```ts
new ExpressionEngine({
  config: { date: { holidays: ["2024-12-25", "2024-12-26"] } },
});
// or: { date: { holidays: (date) => isPublicHoliday(date) } }
```

With that calendar, `1 working day after 24/12/2024` steps over the 25th and
26th to the 27th, and `working days between ...` leaves them out of the count.
The offset forms, `between`, and `<date> + N workdays` all consult it.

`workdays in <span>` and the `is a workday` / `is a weekend` questions stay
weekends-only either way: the first has no date to look a holiday up on, and the
second reports the shape of the week (is this a weekday), not whether a
particular office is open.
