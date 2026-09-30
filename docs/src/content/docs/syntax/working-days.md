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

```solve
10 business days after 2026-09-30 // Wednesday, October 14, 2026
10 working days before 2026-09-30 // Wednesday, September 16, 2026
1 working day from 2026-09-30 // Thursday, October 1, 2026
1 business day before 2026-09-30 // Tuesday, September 29, 2026
business days between 2026-09-01 and 2026-09-30 // 22
how many working days between 2026-09-01 and 2026-09-30 // 22
```

Every pairing reads the same way: `working` or `business`, in the singular or
the plural, with `after`, `from` or `before`, and for the window `workday
between` as well as the plural, each with or without `how many` in front.

```solve
10 working days after 2026-09-30 // Wednesday, October 14, 2026
10 business days before 2026-09-30 // Wednesday, September 16, 2026
1 business day after 2026-09-30 // Thursday, October 1, 2026
1 business day from 2026-09-30 // Thursday, October 1, 2026
1 working day before 2026-09-30 // Tuesday, September 29, 2026
workday between 2026-09-01 and 2026-09-30 // 22
how many business days between 2026-09-01 and 2026-09-30 // 22
how many workdays between 2026-09-01 and 2026-09-30 // 22
```

`workdays until <date>` and `workdays since <date>` are refused rather than
answered, because the only reading they had was a fixed ratio of five working
days to seven calendar days, which knows no weekends or holidays. Count from
today with `workdays between today and <date>` instead.

## Is a date a working day

A date can be asked whether it is a working day or falls on the weekend, which
is how a note checks a deadline before it is agreed. `is a workday`, `is a
weekday` and `is a business day` ask the first; `is a weekend` and `is on a
weekend` ask the second. The answer is `true` or `false`.

```solve
2026-09-26 is a weekend // true
2026-09-26 is on a weekend // true
2026-09-26 is a business day // false
2026-09-28 is a workday // true
2026-09-28 is a weekday // true
```

The day of the week a date falls on, its month and its week number are on
[weekdays and week numbers](/syntax/weekdays-and-week-numbers/).

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
