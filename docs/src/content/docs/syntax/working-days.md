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
workdays between 01/01/2024 and 31/01/2024 // 23
workdays in 3 weeks // 15
```

Counted from today, the answer moves with the day. The one shown is for
noon on Wednesday 11 March 2026 in London, the fixed moment these pages are checked against, and the notepad gives yours.

```solve
3 business days from today // Monday, March 16, 2026, 12:00:00 PM
```

`working` and `business` days mean the same thing, and either reads in the
singular for a count of one (`1 working day after ...`). `workdays between`, the
unit's own spelling, counts the same window, and `how many` may lead any of them.

`workdays until <date>` and `workdays since <date>` are refused rather than
answered, because the only reading they had was a fixed ratio of five working
days to seven calendar days, which knows no weekends or holidays. Count from
today with `workdays between today and <date>` instead.

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

## Which days are the weekend

The weekend is Saturday and Sunday unless the host says otherwise. In much of
the Middle East it is Friday and Saturday, so one working day after Thursday 1
January 2026 is Sunday 4 January, not Friday 2 January. A host sets the weekend
by naming its days, and the first day of the week the same way:

```ts
createEngine({
  config: { date: { weekend: ["friday", "saturday"], firstDayOfWeek: "sunday" } },
});
```

With that engine, `1 working day after 2026-01-01` is Sunday, January 4, 2026,
`2026-01-02 is a weekend` is true, and `start of week` is the Sunday before. An
empty list makes every day a working day. A name that is not a day of the week
is refused when the engine is built, with `DATE_WEEKDAY_INVALID`, rather than
quietly ignored.

Left unset, both come from the engine's locale when its tag names a region and
the runtime reports that region's week (through `Intl.Locale`): `ar-SA` and
`he-IL` have a Friday and Saturday weekend with the week starting on Sunday,
`en-US` starts its week on Sunday, and `en-GB` on Monday. A bare language such
as `en`, the default, names no region, so it keeps Saturday and Sunday and a
Monday start. Each setting stands on its own: a host can name the weekend and
let the locale choose the first day.

The weekend is what the working-day arithmetic skips, what `is a weekend` and
`is a workday` answer from, and the first day is where the week forms on
[relative dates](/syntax/relative-dates/) begin. Two things do not move with
it: the ISO week number (`week number of`), which is Monday-based by
definition, and `workdays in <span>` with the `workday` unit in a rate, which
stay a fixed five working days to seven.
