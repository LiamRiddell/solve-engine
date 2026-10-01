---
"solve-engine": minor
---

A clock time is shown as a time of day, and `as time` shows any date that way: `9:00am + 3 hours` is `12:00:00 PM`

A clock time is a time of day to the reader, and the engine printed it as a full date: `9:00am + 3 hours` showed today's weekday and date, and no form showed another date as a time alone (#708). The time page documented `12:00:00 PM` for that line in a table nothing checked.

| line | before (on 25 September 2026) | now |
| --- | --- | --- |
| `9:00am` | Friday, September 25, 2026, 9:00:00 AM | 9:00:00 AM |
| `9:00am + 3 hours` | Friday, September 25, 2026, 12:00:00 PM | 12:00:00 PM |
| `11pm + 2 hours` | Saturday, September 26, 2026, 1:00:00 AM | 1:00:00 AM (+1 day) |
| `6pm in Chicago` | Friday, September 25, 2026, 6:00:00 PM | 6:00:00 PM |
| `2026-04-03T09:30 as time` | `Unknown converter "as time"` | 9:30:00 AM |

A datetime carries a new grain, `time`, beside `date`, `datetime` and `instant`. A clock time takes it, duration arithmetic keeps it, and so does `in <zone>`. It is shown as the time alone, in words or, under a numeric date format, as `HH:MM:SS`, with the days it has moved beside it, the way the time-zone forms write a day shift. The day it is counted from is recorded on the value when the time is written (today for a clock time, the value's own day for `as time`), so the shift does not change with the day the answer is shown on. The instant is unchanged; only its display is.

`as time` shows a date and time as its time of day. It takes a date: a plain number or text has no time of day of its own, and `5 as time` would otherwise be a moment in 1970, so each is refused by name, with the way to read a timestamp first (`1710000000 as date as time`). The grain and the day it is counted from cross a snapshot and the worker boundary with the value.

The boundary: arithmetic between clock times does not change (`9am to 5pm` is still 480 minutes, `5pm - 9am` still `8:00`). A clock time is still read as that time today, and the host's date display settings still apply to full dates. The time page's clock examples are now proven lines, and the time-zones page shows `6pm in Chicago` as the time it is.

## Verification

`Issue701_708_timeOfDayAndTimestamps.spec.ts` holds 41 tests across the two issues: a clock time shown as a time of day with its day shift, `as time` on a date and its refusal of a number, the anchor day kept across a snapshot and the worker boundary, and the time-zone forms that answer with a clock time.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
