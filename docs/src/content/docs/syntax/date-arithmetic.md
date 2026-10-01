---
title: "Date arithmetic"
description: Adding and subtracting days, weeks and hours from a date.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Adding a span to a date moves it forward, and subtracting one moves it back, so
you can ask what day falls twenty days after a fixed date, or three hours after
now. A form relative to now resolves against the current date. The answers
shown for those are worked out for noon on Wednesday 11 March 2026 in London, the fixed moment these pages are checked against, and the notepad works them out for
your own now.

A day count crosses month and year boundaries; the relative forms resolve
against now.

```solve
25/12/2023 + 20 days // Sunday, January 14, 2024
```

```solve
now + 3 hours // Wednesday, March 11, 2026, 3:00:00 PM
today - 1 week // Wednesday, March 4, 2026, 12:00:00 PM
```

## The same sum in words

`from`, `after` and `before` put the span in front of the date, which is how a
deadline, a notice period or an invoice term is usually written down. They are
the operators above in words, so they answer the same thing.

```solve
30 days from 3 March 2026 // Thursday, April 2, 2026
2 weeks after 3 March 2026 // Tuesday, March 17, 2026
30 days before 3 March 2026 // Sunday, February 1, 2026
3 months from 3 March 2026 // Wednesday, June 3, 2026
```

`from` and `after` count forward and `before` counts back. The anchor can be any
date the engine reads, including a relative one:

```solve
3 days from today // Saturday, March 14, 2026, 12:00:00 PM
```

The connector is only read this way when a span is in front of it, which is what
keeps `$1,000 after 3 years at 7%` an [investment](/syntax/investments/). `to` is deliberately not
claimed for an offset, because between two dates it already means something:
the span from the first to the second, in days, which `in weeks` converts. A
later date first gives a negative span, as subtracting them does. Between two
numbers the same word is a [percentage change](/syntax/percentages/), and a
date against a number has neither reading, so it is refused.

```solve
2 April 2026 to 6 September 2026 // 157 days
(1 Jan 2026 to 1 Mar 2026) in weeks // 8.43 weeks
1 Mar 2026 to 1 Jan 2026 // -59 days
```

Two dates on a midnight are counted in calendar days, as `days between` counts
them, so a change of clocks inside the span does not make it a day short.

## A length in several units

A length of time is often written in more than one unit at once: a notice
period of one month and one day, a term of a year and two months. Months and
years are not a fixed number of days (a month is 28 to 31 of them), so adding
one to a date moves the month on the calendar instead, and a month that runs
out of days lands on its last one: 31 January plus a month is 28 February.

A length written this way is added to a date one part at a time, the largest
first, exactly as if each part had its own `+`. So `2026-01-31 + 1 month 1 day`
is 31 January, plus a month (28 February), plus a day: 1 March. Taking a length
away works the same way, so a month and a day before 31 March is 28 February
minus a day, the 27th. `after`, `from` and `before` apply the parts in the
same order.

```solve
2026-01-31 + 1 month 1 day // Sunday, March 1, 2026
2026-01-31 + 1 month + 1 day // Sunday, March 1, 2026
2024-01-31 + 1 month 1 day // Friday, March 1, 2024
2026-03-31 - 1 month 1 day // Friday, February 27, 2026
2024-02-29 + 1 year 1 day // Saturday, March 1, 2025
1 month 1 day after 2026-01-31 // Sunday, March 1, 2026
1 month 1 day before 2026-03-31 // Friday, February 27, 2026
```

The order matters because the steps do not always give the same date the other
way round. From 30 January, a day and then a month is 31 January and then 28
February, while a month and then a day is 28 February and then 1 March. Largest
first is the order the length is written in, and the order an ISO 8601
duration such as `P1M1D` uses, so the two agree:

```solve
2026-01-30 + 1 month 1 day // Sunday, March 1, 2026
2026-01-30 + P1M1D // Sunday, March 1, 2026
2026-01-30 + 1 day + 1 month // Saturday, February 28, 2026
```

A day followed by hours is a calendar day and then the hours. On the night the
clocks change, a day is 23 or 25 hours long, so `1 day 2 hours` from noon is two
in the afternoon on the clock, where `26 hours` is twenty-six hours of elapsed
time and shows one hour more or less.

The boundary: only a length led by a day or longer is applied in parts, since
hours and minutes are a fixed length and sum to the same thing either way. The
parts are written largest first; `1 day 1 month` is refused rather than
reordered. A length in brackets, scaled, converted or kept in a variable is
one length, summed into its smallest unit at the unit table's 30-day month,
because by then it is a quantity in its own right rather than a list of steps:

```solve
1 month 1 day // 31 days
2026-01-31 + (1 month 1 day) // Tuesday, March 3, 2026
```

## A date in another zone

A day is a step on the calendar, not a fixed 24 hours: on the night the clocks
go back a day lasts 25 hours, and on the night they go forward 23. So adding a
day to a date keeps the time its clock shows and moves the date, and a date
written in a zone (see [time zones](/syntax/time-zones/)) moves on that zone's
calendar, wherever the engine itself is running. New York's clocks went back
on 3 November 2024, so a day after noon on the 2nd is noon on the 3rd there,
while 24 hours after it is 11 in the morning:

```solve
2024-11-02 12:00 in New York + 1 day // Sunday, November 3, 2024, 12:00:00 PM
2024-11-02 12:00 in New York + 24 hours // Sunday, November 3, 2024, 11:00:00 AM
2024-10-30 09:00 in New York + 1 week // Wednesday, November 6, 2024, 9:00:00 AM
2024-01-31 12:00 in Tokyo + 1 month // Thursday, February 29, 2024, 12:00:00 PM
```

Weeks, fortnights, months and years step the zone's calendar the same way, and
a month that runs out of days lands on its last one. Hours and minutes stay
elapsed time, which is what a duration in hours means. Working days are the one
step still counted on the engine's own calendar rather than the date's zone.

For a span that skips weekends and holidays, `30 working days from 3 March 2026`
is the sibling form; see [working days](/syntax/working-days/).
