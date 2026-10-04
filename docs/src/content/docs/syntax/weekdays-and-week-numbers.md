---
title: "Weekdays & week numbers"
description: Which day of the week, which month and which numbered week a date falls in, asked as a question.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A date names a day on the calendar, and three things about it are often wanted
on their own: the day of the week it falls on, its month, and its week number,
the count of weeks from the start of the year that offices and planners use to
name a week ("week 12"). Each can be asked as a question, about a date, about
today, or about a day some time from now.

The questions about today are worked out for one fixed moment, noon on
Wednesday 11 March 2026 in London, so that they can be checked; the notepad
under each example works them out for your own today.

## The day of the week

`what day is it on`, `day of the week on` and `weekday on` all ask which day of
the week a date falls on. The answer is the day's name.

```solve
what day is it on 2026-12-25 // Friday
what day is it on 25 december // Friday
day of the week on 1 January 2000 // Saturday
weekday on 2026-12-25 // Friday
```

`what day is it` on its own asks about today, and a length of time after `in`
asks about a day that far ahead. `what day will it be` reads the same, with `in`
or `on`.

```solve
what day is it // Wednesday
what day is it in 3 days // Saturday
what day will it be in 3 days // Saturday
what day will it be on 2026-12-25 // Friday
```

## The month

The month questions follow the same shape: `what month is it` for today, `on` a
date, `in` a length of time, and `month of` a date.

```solve
what month is it // March
what month is it on 2026-12-25 // December
what month is it in 3 months // June
what month will it be in 10 months // January
month of 2026-12-25 // December
```

## The week number

The week number here is the ISO week, the international standard (ISO 8601)
most of Europe and most planning software use. Its weeks run Monday to Sunday,
and week 1 is the week holding the year's first Thursday. So the last days of
December can fall in week 1 of the next year, and the first days of January in
week 52 or 53 of the one before: Friday 1 January 2027 is in week 53 of 2026.

`week number of` a date gives its week, and `week number` alone gives this
week's. `what week is it` asks the same with `on` a date or `in` a length of
time.

```solve
week number // 11
week number of 2026-12-25 // 52
week number on 2026-12-25 // 52
week number of 2027-01-01 // 53
what week is it // 11
what week is it on 2026-12-25 // 52
what week is it in 2 weeks // 13
what week will it be in 2 weeks // 13
```

## As a conversion

The same three answers can be asked for with `as`, the way a date is shown in
another form, which reads well after a date worked out on the same line.

```solve
2026-12-25 as weekday // Friday
2026-12-25 as month // December
2026-12-25 as week // 52
```

## The boundary

- The week number is always the ISO one. The other conventions (weeks starting
  on a Sunday, or week 1 as the week holding 1 January, as in the United States)
  are not read.
- A day name on its own is not a date, so `Tuesday is a business day` is refused
  rather than guessed; whether a date is a working day is asked of a date, on
  [working days](/syntax/working-days/).
- The answer is the name or the number alone. To show a date's full form, see
  [displaying dates](/syntax/displaying-dates/).
