---
"solve-engine": patch
---

A day added to a date written in a zone is a day on that zone's calendar, whatever zone the engine runs in

A day is a calendar step, not a fixed 24 hours: adding one keeps the time the clock shows and moves the date, across a change of clocks included. The step was taken on the engine's own calendar, which for the default backend is the host's zone, so a date written in a zone moved on the host's clock rather than its own. On a host in UTC, a day after noon in New York on 2 November 2024, the day before New York's clocks went back, answered 11:00 on the 3rd, twenty-four hours on; a host in London or in Kiritimati stepped its own calendar instead, so the same line answered differently depending on where the engine ran. Weeks, fortnights, months and years had the same fault. A date that carries a zone now steps its days and months on that zone's calendar (`calendar/ZonedSteps.ts`).

| line | before, on a host in UTC | now, on any host |
| --- | --- | --- |
| `2024-11-02 12:00 in New York + 1 day` | Sunday, November 3, 2024, 11:00:00 AM | Sunday, November 3, 2024, 12:00:00 PM |
| `2024-03-09 10:00 in New York + 1 day` | Sunday, March 10, 2024, 11:00:00 AM | Sunday, March 10, 2024, 10:00:00 AM |
| `2024-03-10 01:30 in New York + 1 day` | Monday, March 11, 2024, 2:30:00 AM | Monday, March 11, 2024, 1:30:00 AM |
| `2024-11-02 12:00 in New York + 24 hours` | Sunday, November 3, 2024, 11:00:00 AM | Sunday, November 3, 2024, 11:00:00 AM |

Hours and minutes stay elapsed time, which is what a duration in hours means, and a date with no zone steps the engine's own calendar as it did. The date arithmetic page gains the proven examples.

The boundary. Working days still walk the engine's own calendar rather than the zone's: #832 reshaped the workday walk for configurable weekends but did not move it onto a date's zone, so the spec pins that case as a `test.failing`. The other half of this report, a zoned date past the range a calendar holds throwing a raw `RangeError` where it is displayed, is fixed by #832, which refuses such a date where it is made (`DATE_OUT_OF_RANGE`), and the spec asserts that refusal.

## Verification

`FoundBug_zonedDateSteps.spec.ts` holds 42 tests, one of them the pin above: each step on engines whose calendar sits in UTC, London, New York, Kiritimati and Kolkata, with one answer for all five, both document passes agreeing with a single expression, the unit tests of `fieldsInZoneRef`, `addZonedCalendarDays` and `addZonedCalendarMonths` with ordinary, boundary and hostile arguments (an instant past the range, an unknown zone, prototype words as zones), a step of a million days, forward and back again, a leap day, a month end and a year end. The spec passes under `SOLVE_CALENDAR=temporal` as well. `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, the proven docs examples and `npm run test:ci` passed. The full suite ran 26,457 tests in 761 suites on this branch, and `npm run test:temporal` passed its 3,461 tests in 95 suites.
