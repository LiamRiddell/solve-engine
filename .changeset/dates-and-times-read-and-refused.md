---
"solve-engine": patch
---

Dates and times: Oct and Dec are months, a dotted time keeps its minutes, a moment is refused in arithmetic, a pace may carry its minute unit, and a date moves only by a length of time

Nine date and time faults from the 2026-09-25 survey. Most gave a number that looked like an answer and was not one: a date's epoch milliseconds, or a date left where it was.

**Oct and Dec are months (#623).** `oct` and `dec` also name the octal and decimal conversions, so they lexed as those, and the month-name rule never saw them. The rule now takes them too, except straight after `as`, `in` or `to`, where they are still the conversion.

| line | before | now |
| --- | --- | --- |
| `1 Oct 2026` | error: Unexpected token after expression: "Oct" | Thursday, October 1, 2026 |
| `25 Dec 2026` | error: Unexpected token after expression: "Dec" | Friday, December 25, 2026 |
| `255 as dec` | 255 | 255 |

**A dotted time keeps its minutes (#624).** `3.30pm` read its hour from the number the lexer made of `3.30`, which is 3.3, so it was 3:00 PM. The hour and minutes are now read from the text. Only two digits after the point are minutes: `3.5pm` could mean half past or five past, so it is not read as a time at all.

| line | before | now |
| --- | --- | --- |
| `3.30pm` | 3:00 PM today | 3:30 PM today |
| `10.45am` | 10:00 AM today | 10:45 AM today |

**A date or time is refused in arithmetic (#625).** Only `+` and `-` guarded a date, so everything else read it as its epoch milliseconds. Multiplying, dividing, a remainder, a power, a negation, the numeric functions, `% of`, `as %`, and a unit written after a clock time are each refused by name now, with a pointer to the ways a length of time is written. Figures from 25 September 2026 at about 15:00 in London, since each carried the day's date:

| line | before | now |
| --- | --- | --- |
| `1:30 * 3` | 5,370,888,600,000 | A date or time cannot be multiplied: it is a moment, not an amount. A length of time is written 1h30m, 90 minutes or 1:30:00. |
| `round(1:30)` | 1,790,296,200,000 | round takes a number, not a date or time: ... |
| `1:30 hours in minutes` | 107,417,772,000,000 minutes | A date or time cannot take a unit, hours: ... |
| `1 Jan 2026 as %` | 176722560000000.00% | A date or time cannot be written as a percentage: ... |

Comparisons, `min` and `max`, `as number`, `to timestamp` and spans are unchanged, since they ask about order or for the number: `9:00 > 8:00` is true, `1 Jan 2026 as number` is 1,767,225,600,000 and `(9:30 - 8:30) * 3` is 3:00. A host with `date.onAmbiguous: "arithmetic"` no longer gets the fourteen-digit answer for `29 February 2026`, which was 29 times the instant of 1 February; it gets the multiplication refusal.

**A pace may carry its minute unit, or `per` (#626).** The pace rule wanted the slash straight after the seconds.

| line | before | now |
| --- | --- | --- |
| `5:30 min/km` | 29838510000:00:00 /km | 5:30 /km |
| `5:30 min per km` | 29838510000:00:00 /km | 5:30 /km |
| `10 km at 5:30 min/km` | 17,903,106,000,000.00 min | 3,300 seconds |

Only a minute unit is read this way; `5:30 h/km` is refused as a clock time with a unit.

**A date moves only by a length of time (#627).** A unit that is not a time was read as nothing and a bare number as milliseconds, so the date came back unchanged or a few milliseconds on.

| line | before | now |
| --- | --- | --- |
| `1 Jan 2026 + 5 kg` | Thursday, January 1, 2026 | A date or time moves by a length of time, such as 5 days, 2 weeks or 3 hours, not by a mass. |
| `1 Jan 2026 + 5` | Thursday, January 1, 2026, 12:00:00 AM | A date or time moves by a length of time, and a plain number does not say whether it means days, hours or minutes. Write the unit, as in + 5 days. |

A bare number is refused rather than read as days, since nothing on the line says which unit it means. `+ 5 days`, `+ 5 workdays`, `+ 1 month`, `+ 1h30m` and a span from subtracting two times all move a date as before. `2026-04-03 in GMT+9`, read as `(2026-04-03 in GMT) + 9`, is now this refusal rather than nine milliseconds; the time-zones page says so.

**A span stays a span with a length of time added (#629).** Only two spans added together, or a span scaled by a number, kept the clock display.

| line | before | now |
| --- | --- | --- |
| `(9:30 - 8:30) + 30 minutes` | 5,400,000.00 ms | 1:30 |
| `30 minutes + (9:30 - 8:30)` | 90 minutes | 1:30 |

A typed quantity in milliseconds keeps its milliseconds: `(9:30 - 8:30) + 40ms` is 3,600,040.00 ms, since a clock shows whole seconds.

**`workdays between` counts the calendar (#630).** It fell to the generic `<unit> between`, whose workday is a fixed seven fifths of a day.

| line | before | now |
| --- | --- | --- |
| `workdays between 01/01/2024 and 31/01/2024` | 21.43 workdays | 23 |
| `how many working days between 01/01/2024 and 31/01/2024` | error: Unexpected token after expression: "many" | 23 |
| `workdays until 25 December 2026` | 64.58 workdays (on 25 September 2026) | refused, pointing at `workdays between today and <date>` |

**`to` between two dates is the span (#631).** `a to b` compiled `b / a - 1` whatever the operands were. A new opcode decides when the line runs, since either side can be a variable.

| line | before | now |
| --- | --- | --- |
| `1 Jan 2026 to 1 Mar 2026` | 0.29% | 59 days |
| `2 April 2026 to 6 September 2026` | 0.76% | 157 days |
| `1 Mar 2026 to 1 Jan 2026` | -0.29% | -59 days |
| `1 Jan 2026 to 5` | -100.00% | refused |

Two numbers give the percentage change exactly as before (`10 to 20` is 100.00%), through the same opcodes.

**`as iso8601` reads a timestamp in seconds (#632).** It read every number as milliseconds.

| line | before | now |
| --- | --- | --- |
| `1710000000 as iso8601` | 1970-01-20T20:00:00+01:00 | 2024-03-09T16:00:00+00:00 |
| `5 kg as iso8601` | 1970-01-01T01:00:00+01:00 | refused by name |

It now reads its argument as `to date` does: a date as it is, a number through the same seconds-or-milliseconds threshold, text through the ISO 8601 parser. A timestamp past the dates a JavaScript date can hold, about 273,000 years either side of 1970, is refused by both (`DATE_OUT_OF_RANGE`), where `(2^53) as iso8601` wrote `NaN-NaN-NaNTNaN:NaN:NaN-NaN:NaN` and `(2^53) to date` showed `Invalid Date, Invalid Date`; the adversarial sweep's numeric edges found it.

What these deliberately leave for later: a clock sum after a minus (`17:30 - 9:00 + 0:45`, #628) needs a bare `0:45` told apart from `0:45am` when the line runs, and is its own change; so are signed UTC offsets after a time and a date with a time of day. `today` as the current instant and date minus date as elapsed time stay as they are, held for 3.0.

The time, timesheets, health, time-zones, date-arithmetic, working-days and date-literals pages describe each change, with proven examples.

## Verification

New tests pin each issue under `__tests__/bugs` (#623 to #627 and #629 to #632), each with an adversarial section: every arithmetic form and numeric function against a clock time, an am/pm time, a date literal, an ISO date-time, `today` and `now`, on either side and held in a variable; the boundaries that must not move (comparisons, `min` and `max`, `as number`, spans); a pace with every minute spelling, `per`, and the shapes that are not a pace; a date plus each kind of non-duration; a span plus each time unit, typed milliseconds and a variable; the edges of a working-day window and a host holiday calendar; `to` between dates, variables and a date against a number; and timestamps at the seconds threshold and past the calendar. Unit tests cover the new helpers (`datetimeArithmeticRefused`, `datetimeTakesNoUnit`, `datetimeConversionRefused`, `datetimeArgumentRefused`, `asIso8601`) and the new `PERCENT_CHANGE` opcode on hand-built bytecode. The adversarial sweep gains a dates group of eight forms over its numeric edges, which found the out-of-range timestamp. Nine existing tests that pinned the old readings (a bare number as milliseconds, a non-duration ignored, the fourteen-digit `onAmbiguous` answer, a nine-millisecond UTC offset) now pin the refusals. The VM dispatch loop is 47,326 bytes, 476 over main and well under the 61,440 ceiling.

The full suite is 13,744 tests in 562 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
