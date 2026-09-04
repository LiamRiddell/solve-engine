---
"solve-engine": minor
---

Clock times added together are the timesheet column, not two times of day.

`8:15 + 7:45 + 8:30` was refused, and read strictly it deserved to be: there is no such thing as half past eight plus quarter to eight. But a timesheet writes each day as hours and minutes and adds the column up, and that is the only reading the line can have.

| before | now |
| --- | --- |
| `8:15 + 7:45` was `Cannot add two datetimes together` | `960 minutes` |
| `8:15 + 7:45 + 8:30` was the same refusal | `1,470 minutes` |

The total is an ordinary duration, so everything a duration already does applies without any of it being written twice.

```
8:15 + 7:45 + 8:30 in hours    24.50 hours
8:15 + 7:45 + 30 minutes       990 minutes
8:15 + 7:45 at £15/hour        £240.00
```

The boundary is what stays a time of day. `8:15` on its own is still quarter past eight this morning, and `8:15 + 30 minutes` is still quarter to nine that same morning. A time written with `am` or `pm` is a time of day and nothing else, so `9am + 5:30pm` is still refused rather than answered with a number that means nothing. A `-` between two clock times is left alone, because it is genuinely ambiguous: `5pm - 7pm` reads as a range and `5pm - 2pm` as a subtraction, and the interval form already refuses to guess between them.

Spans and hourly rates are unchanged and now documented alongside the sum: `9:00 to 17:30` is `510 minutes`, `9pm to 5am` is `480 minutes` rather than a negative span, and `9:00 to 17:30 at £15/hour` is `£127.50`. There is a new [Timesheets](https://liamriddell.github.io/solve-engine/syntax/timesheets/) page for the three of them together.

One internal change comes with it: a fused clock-time token now carries its own source text instead of a copy of its minutes value. Nothing reads that text as a payload, the minutes stay in the token's value, and it is what lets a sum tell `8:15` from `8:15am`. Spans reported against a clock time now cover what was actually written.
