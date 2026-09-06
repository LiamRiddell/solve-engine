---
"solve-engine": patch
---

Milliseconds: a quantity is shown as a quantity, and a stretch of time as a clock

`ms` used to be a unit nobody could type, so every value carrying it was the gap
between two clock times and the formatter could show all of them on a clock. It
is typeable now, and a latency budget was being read as a time of day.

| expression | before | now |
| --- | --- | --- |
| `40ms + 120ms + 30ms` | `0:00` | `190.00 ms` |
| `95ms * 3` | `0:00` | `285.00 ms` |
| `2 minutes in ms` | `0:02` | `120,000.00 ms` |
| `9:30 - 8:30` | `1:00` | `1:00` |

The two readings share a unit, so the engine now records which one it measured:
subtracting one datetime from another marks the result as a stretch of time, and
only a marked value is shown on a clock.

The mark survives the arithmetic that keeps a stretch a stretch, which is what a
timesheet needs. Two of them add, one scales by a plain number, and a column of
them totals, by position or by category tag:

```
9:30 - 8:30
12:00 - 11:00
18:00 - 12:55
total above          7:05
```

It deliberately does not survive two things. A conversion drops it, because
`(9:30 - 8:30) in minutes` named the unit it wanted and is given `60 minutes`.
And combining a stretch with a quantity somebody typed drops it, so
`(9:30 - 8:30) + 40ms` is a count of milliseconds rather than a clock implying it
is still a shift. Both fail towards the plain number, which is the direction that
cannot mislead.

[Timesheets](https://liamriddell.github.io/solve-engine/syntax/timesheets/) gains
a proven section covering both readings, which is the example that would have
caught this.
