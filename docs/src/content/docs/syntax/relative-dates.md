---
title: "Relative dates"
description: Naming a day by its relation to today, like tomorrow or next friday.
---

> **Package:** `DATETIME_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A relative date names a day by its relation to today rather than by its
calendar number, the way you would say tomorrow or next friday out loud. Each
resolves against the current date. The answers on this page are worked out for
one fixed moment, noon on Wednesday 11 March 2026 in London, so that they can be
checked; the notepad under each example works them out for your own today.

```solve
now // Wednesday, March 11, 2026, 12:00:00 PM
today // Wednesday, March 11, 2026, 12:00:00 PM
tomorrow // Thursday, March 12, 2026, 12:00:00 PM
yesterday // Tuesday, March 10, 2026, 12:00:00 PM
next friday // Friday, March 13, 2026, 12:00:00 PM
last monday // Monday, March 9, 2026, 12:00:00 PM
```

## What each one means

A few of these read differently from how they are often said, so each is set
out here, against the same fixed moment.

**`today` is the current instant, not the start of the day.** `today` and `now`
are the same moment, with the time of day included, so `tomorrow` and
`yesterday` are that same time a day later or earlier. A count of days from
today includes the part of today already gone, which is why it is usually not a
whole number: at noon, `days until 25 december` is 288.50 days rather than 289.
That is the engine's default; an app can choose to start these days at midnight
instead, as [counting from the start of the day](#counting-from-the-start-of-the-day)
sets out.

```solve
today // Wednesday, March 11, 2026, 12:00:00 PM
days until 25 december // 288.50 days
3 days from today // Saturday, March 14, 2026, 12:00:00 PM
3 days before today // Sunday, March 8, 2026, 12:00:00 PM
```

**`next` and `last` step over today.** `next friday` is the first Friday after
today and `last friday` the most recent one before it, so either one said on a
Friday is a week away rather than today. On Wednesday 11 March, `next friday` is
the 13th and `last friday` the 6th, and `next saturday` is the 14th, the day
after that Friday.

```solve
next friday // Friday, March 13, 2026, 12:00:00 PM
last friday // Friday, March 6, 2026, 12:00:00 PM
next saturday // Saturday, March 14, 2026, 12:00:00 PM
```

## Days ago

A length of time followed by `ago` counts back from now, the way
`3 days before today` does, so it carries the time of day as `today` does. Any
length of time works, from minutes to years.

```solve
3 days ago // Sunday, March 8, 2026, 12:00:00 PM
2 hours ago // Wednesday, March 11, 2026, 10:00:00 AM
1 year ago // Tuesday, March 11, 2025, 12:00:00 PM
```

`ago` is read this way only straight after a length of time. Anywhere else it
is an ordinary word, so a note that says `3 days ago I paid` is left as text,
and a variable called `ago` still works.

## This week, next month, last year

`next week`, `this month`, `last week` and `last year` name a whole week, month
or year, and each stands for its first day: `next month` is the first of next
month, and `next week` is next Monday. A week runs Monday to Sunday unless the host starts
it on another day, or the engine's locale names a region whose week does (see
[working days](/syntax/working-days/#which-days-are-the-weekend)).

```solve
next week // Monday, March 16, 2026
this week // Monday, March 9, 2026
last week // Monday, March 2, 2026
next month // Wednesday, April 1, 2026
next year // Friday, January 1, 2027
last year // Wednesday, January 1, 2025
```

`start of` and `end of` pick the first or last day of a week, month or year,
the current one or a named one. `beginning of` is `start of`. The answer is the
day itself, at the start of it, so `end of month` is the 31st rather than the
last minute of it.

```solve
start of month // Sunday, March 1, 2026
end of month // Tuesday, March 31, 2026
end of next month // Thursday, April 30, 2026
end of week // Sunday, March 15, 2026
start of year // Thursday, January 1, 2026
end of last year // Wednesday, December 31, 2025
```

Each is an ordinary date, so it moves by a length of time and counts down like
any other:

```solve
end of month + 1 day // Wednesday, April 1, 2026
next week + 2 days // Wednesday, March 18, 2026
```

`start` and `end` are claimed only before `of` and a period, so they stay free
as names: `start = 5` and `end - start` work as they always have.

## A day of the week

`this friday` is the coming Friday: later this week, or today when today is a
Friday. That is the difference from `next friday`, which always steps over
today. Like `next friday`, it keeps the time of day.

```solve
this friday // Friday, March 13, 2026, 12:00:00 PM
this wednesday // Wednesday, March 11, 2026, 12:00:00 PM
next wednesday // Wednesday, March 18, 2026, 12:00:00 PM
```

A day of the week on its own inside a sum, or after `days until`, reads as
`this friday` does:

```solve
friday + 1 week // Friday, March 20, 2026, 12:00:00 PM
days until friday // 2 days
```

A day of the week alone on a line is not read as a date. Notes head a day with
its name (`Friday`, then the day's lines under it), and that heading should stay
text, so a line that is only a weekday is refused with a message suggesting
`this friday` or `next friday`. A heading with a colon, `Friday: 3 hours`, is
unaffected: the part after the colon is the line.

## Counting from the start of the day

A note that plans by the day usually means a date, not a moment, when it says
`tomorrow`: `today + 3 weeks` is a deadline, and the minute the line was typed
is noise on it. An app that embeds the engine can choose that reading with one
setting, `date.relativeDays`. It takes two values:

- `"now"`, the default: each relative day is the current instant moved by whole
  days, with the time of day, as the examples above show.
- `"midnight"`: each relative day starts at midnight, so it is a date with no
  time of day, and a count of days from today is a whole number.

```ts
createEngine({ config: { date: { relativeDays: "midnight" } } });
```

The same lines at the same moment, noon on Wednesday 11 March 2026, under each:

| line | `"now"` (the default) | `"midnight"` |
| --- | --- | --- |
| `today` | Wednesday, March 11, 2026, 12:00:00 PM | Wednesday, March 11, 2026 |
| `tomorrow` | Thursday, March 12, 2026, 12:00:00 PM | Thursday, March 12, 2026 |
| `next friday` | Friday, March 13, 2026, 12:00:00 PM | Friday, March 13, 2026 |
| `3 days ago` | Sunday, March 8, 2026, 12:00:00 PM | Sunday, March 8, 2026 |
| `today + 3 weeks` | Wednesday, April 1, 2026, 12:00:00 PM | Wednesday, April 1, 2026 |
| `days until 25 december` | 288.50 days | 289 days |
| `tomorrow - today` | 24:00 | 1 day |
| `now` | Wednesday, March 11, 2026, 12:00:00 PM | Wednesday, March 11, 2026, 12:00:00 PM |
| `2 hours ago` | Wednesday, March 11, 2026, 10:00:00 AM | Wednesday, March 11, 2026, 10:00:00 AM |

Under `"midnight"` the setting reaches `today`, `tomorrow` and `yesterday`,
`next` and `last` with a weekday, `this friday` and a bare weekday in a sum, a
span of a day or more followed by `ago`, and the count in `days until` and
`days since` (and in weeks, months or years). Two days subtract to a count of
days, as two written dates do, rather than to hours on a clock.

The boundary, and why: `now` stays the current instant under both settings, and
so does a span shorter than a day (`2 hours ago`, `hours until 5pm`), because
those are questions about the clock. A time added to the start of the day is a
time on it, so `today + 2 hours` is 2:00 AM; write `now + 2 hours` for two hours
from now. `next week`, `end of month` and the other whole periods already name a
day, so they read the same under both. The default stays `"now"` within the
current major version, because changing it would change every answer at the top
of this page for apps that rely on them.

## The boundary

Some natural spellings are still not read, and a line that uses one is refused
rather than guessed at. Each has a spelling that works:

| Not read | Write instead |
| --- | --- |
| `in 3 days` | `3 days from today` |
| `a week ago` | `1 week ago` |
| `the day after tomorrow` | `tomorrow + 1 day` |
| `Monday next week` | `next week`, which is its Monday |
| `tomorrow at noon` | `tomorrow` and a clock time on separate lines |
| `next weekend` | `next saturday` |
| `end of quarter` | `end of month` on the quarter's last month |

The week starts on Monday unless the host or the locale's region says
otherwise. A date so far away that no calendar holds it,
past AD 275760 or before 271821 BC, is refused rather than shown:
`99999999999 days ago` is an error, not a date.

Reading `today` as a date with no time of day, and counting `days until` in
whole calendar days, is a setting an app opts into
([counting from the start of the day](#counting-from-the-start-of-the-day)),
not the default, since the default's answers are the ones described above.
