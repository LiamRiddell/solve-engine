---
"solve-engine": minor
---

A date takes a time of day the way people write one: `2026-01-04 14:30`, `23 September 2026 at 3pm` and `3pm on 23 September 2026`

A date and a time together could be written only in the ISO form, `2026-01-04T14:30` (#692). The way people write a meeting or a deadline, a date and then a time, threw, and the message quoted the clock time's minutes since midnight rather than anything the reader typed.

A calendar date followed by a clock time, bare or after `at`, and a clock time followed by `on` and a date, now read as that moment: the same instant the ISO form names, with the same wall-clock grain, so it goes wherever that form goes.

| line | before | now |
| --- | --- | --- |
| `2026-01-04 14:30` | throws `Unexpected token after expression: "870"` | Sunday, January 4, 2026, 2:30:00 PM |
| `23 September 2026 at 3pm` | throws `Unexpected token after expression: "at"` | Wednesday, September 23, 2026, 3:00:00 PM |
| `3pm on 23 September 2026` | throws `Unexpected token after expression: "on"` | Wednesday, September 23, 2026, 3:00:00 PM |
| `2026-01-04 14:30:15` | throws `Unexpected token after expression: "52215"` | Sunday, January 4, 2026, 2:30:15 PM |
| `hours between 2026-01-04 9am and 2026-01-10 5pm` | throws `Expected token type "AND_CONJ" but got "CLOCK_TIME" ("540")` | 152 hours |

The time is any clock time the engine reads on its own (`14:30`, `3pm`, `9:30am`, `3.30pm`), or `HH:MM:SS` for seconds. After `on`, anything that gives a date works, a name or `today` included, as it already did in the time-zone forms. On the days the clocks change, a time in the skipped or repeated hour lands where the ISO form puts it, since the instant is found through the same parser.

Two answers that were wrong change with it. A date followed by a time that does not exist on the clock was read as a label and answered with what followed the colon; it is now refused, as the same time on its own already was. And a line with a stray token after it quotes that token as it was written, where a clock time, a clock interval or an `HH:MM:SS` reading quoted the engine's own number for it.

| line | before | now |
| --- | --- | --- |
| `2026-01-04 24:00` | 0 | `"24:00" is not a valid time` |
| `tomorrow 3pm` | throws `Unexpected token after expression: "900"` | throws `Unexpected token after expression: "3pm"` |
| `2026-01-04 9am to 5pm` | throws `Unexpected token after expression: "540:1020"` | throws `Unexpected token after expression: "9am to 5pm"` |

The boundary: a day named in words and then a time, `tomorrow 3pm`, is not read this way; it belongs with the spoken relative dates, and `3pm on tomorrow` covers it meanwhile. A month with no day (`February 2026 3pm`) takes no time, since there is no day to put it on. The date-first order does not take a source zone (`23 September 2026 3pm London in Tokyo`); the time-zone form, `3pm London on 23 September 2026 in Tokyo`, does. `readDates` describes the date as before, with the time left out of its reading. The date-literals page gains a section with proven examples.

## Verification

`Issue692_dateWithTimeOfDay.spec.ts` holds forty-four tests. Fourteen spellings each give the answer of the `T` literal for that day and time, with its wall-clock grain and instant, and eight forms carry it on as the `T` literal does: a duration added, a subtraction, `days between` and `hours between`, a zone, `frozen`. On both clock changes a time in the skipped or repeated hour lands where the `T` literal's does, and the three entry points agree. After `on`, a name for a date and `today` both work. What must not break is held: `at` before a rate, `on` after a percentage, a clock interval, a spaced subtraction, a date alone as a label, a date followed by a plain number or `13pm`, and a whole month, which takes no time. `24:00`, `25:00` and `9:60` after a date are refused by name, where the first answered 0. The trailing-token message quotes what was typed for a clock time, an interval and `HH:MM:SS`. The adversarial cases: `on` with nothing or not a date after it, a date that failed, prototype words, fifty times after one date, `wallTimeOn` out of range, and `readDates` describing the date as before.

The full suite (`npm run test:full`) passed, 15,629 of 15,633 tests in 614 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (2,873 tests in 90 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,371 documented examples). `executeBytecode` is unchanged at 47,528 bytecode bytes on Node 24.16.0.
