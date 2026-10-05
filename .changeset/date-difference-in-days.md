---
"solve-engine": patch
---

One date taken from another is the number of days between them, so `25/12/2026 - 24/12/2026` is 1 day rather than `24:00`

Two datetimes subtract to the time between them in milliseconds, marked to show on a clock, which is the right answer for `9:30 - 8:30` and for two moments. Two dates written without a time of day took the same path, so `25/12/2026 - 24/12/2026` answered `24:00`, and so did `2026-12-25 - 2026-12-24`: the slash form was read as two dates, not as a division or a time, and it was the clock that was wrong. A date with no time of day names a whole day, and the question between two of them is how many days apart they are. They now subtract to that count, counted on the calendar as `days between` counts it, so a day the clocks change in is still one day and every time zone gives the same answer.

| line | before | now |
| --- | --- | --- |
| `25/12/2026 - 24/12/2026` | `24:00` | `1 day` |
| `2026-12-25 - 2026-12-24` | `24:00` | `1 day` |
| `24/12/2026 - 25/12/2026` | `-24:00` | `-1 day` |
| `31/03/2024 - 30/03/2024` (London) | `23:00` | `1 day` |
| `(2026-12-25 - 2026-01-01) in weeks` | `51.14 weeks` | `51.14 weeks` |
| `2026-12-25 09:00 - 2026-12-24` | `33:00` | `33:00` |

The boundary: when either side has a time of day, as `now`, a clock time or a written time does, the answer stays the time that passed on a clock, since a time in the question asks for the hours. `today` is read as the present moment, so `25/12/2026 - today` keeps the clock; `days until 25/12/2026` is the day count. The date differences page shows the subtraction.

## Verification

`FoundBug_dateDifferenceInDays.spec.ts` holds 21 tests: the slash, ISO and written forms, a negative and a zero difference, a leap day, a year, a clock change, a scaled, converted and ISO 8601 result, a difference added back to a date, a check, the clock kept when a side has a time, agreement with `days between`; unit tests of `dateDifference` (one day and a negative count, the same day, a leap day, both London clock changes, the ends of the calendar, and each side that is not a calendar date); and the adversarial cases (prototype words naming the dates with `Object.prototype` unchanged, text edges, five hundred differences in one sum, dates on lines above through a total, a what-if and a check in both document passes, every numeric edge as a factor, a division of dates, a day that does not exist, a year end). Three specs pinned the old unit (`DateLiteralNormalizerRule.spec.ts`, `DateTimeArithmetic.spec.ts`, `DateTimeCalendar.spec.ts`) and now pin a count in days, and `DocumentZoneAgreement.spec.ts`, which recorded London's 47:00 and 49:00 weekends as a known difference left for later, now pins two days in every zone. The date specs also ran under the Temporal backend. `AdversarialFeatureSweep.spec.ts` gains `(25/12/2026 - 24/12/2026) * X` and a difference added back to a date.

The fast suite ran across 800 suites (28,880 of 28,884 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the hardening and integration suites and the dispatch-loop size check (44,791 bytecode bytes) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.

On top of main, the full suite ran 30,590 tests in 816 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,527 tests.
