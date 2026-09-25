---
"solve-engine": minor
---

`as date` and `as timestamp` sit beside `to date` and `to timestamp`, and Unix timestamps have a page of their own

Every other conversion is spelled with `as`, but an epoch conversion only with `to`, so a reader who wrote `1710000000 as date`, the spelling that works for `as iso8601` and `as weekday`, got an unknown converter (#701). Epoch conversion also had no syntax page.

| line | before | now |
| --- | --- | --- |
| `1710000000 as date` | `Unknown converter "as date"` | Saturday, March 9, 2024, 4:00:00 PM |
| `2024-03-09 as timestamp` | `Unknown converter "as timestamp"` | 1,709,942,400 |
| `1710000000000 as timestamp` | `Unknown converter "as timestamp"` | 1,710,000,000 |

(The dates are shown in London, as the issue's were.)

`as date` is `to date`: the same handler, reading a timestamp in seconds or, at a trillion or more, in milliseconds, and ISO 8601 text, and leaving a date as it is. `as timestamp` writes whole seconds, reading a number as a timestamp first, so one in milliseconds comes back in seconds rather than divided by a thousand again. Both refuse a quantity, money, true or false and a list by name, as `as iso8601` does, rather than read them through their number.

A new syntax page, Timestamps, says what an epoch timestamp is before its first example and covers `to date`, `as date`, `to timestamp`, `as timestamp`, `current timestamp` and `as iso8601`, with proven examples read against the docs' pinned zone and clock. It sits in the Dates group of the sidebar.

The boundary: `to timestamp` on a plain number keeps its old reading of the number as milliseconds; `as timestamp` is the spelling that reads it as a timestamp. `as time`, a time of day, is the time-of-day change that ships beside this one.

## Verification

`Issue701_708_timeOfDayAndTimestamps.spec.ts` holds 41 tests across #701 and #708: `as date` and `as timestamp` beside `to date` and `to timestamp` on seconds, milliseconds, ISO text and dates, and the refusal of a quantity, money, true or false and a list by name.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
