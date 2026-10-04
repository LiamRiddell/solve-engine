---
"solve-engine": patch
---

The `Temporal` backend's clock is checked as the `Date` backend's is: a `now` that answers `NaN` is refused on the line with `DATE_CLOCK_INVALID` rather than shown as `Invalid Date`

`createTemporalCalendar(Temporal, { now })` used the host's clock as it was given (#826). A clock answering `NaN` reached the display as `Invalid Date, Invalid Date`, and one that was not a function failed on first use with `this.clock is not a function`, an uncoded error that named the engine's own code. The `Date` backend's clock (`dateCalendarInZone(zone, { now })`) is checked, and the two now share the check (`calendar/Clock.ts`), so a host moving between the backends meets one contract: a clock that is not a function is refused when the backend is built, and a reading that is not a moment in time (`NaN`, an infinity, a number past 8.64e15 either side of the epoch, anything that is not a number) or a clock that throws is refused on the line that read it. Both refusals are `DATE_CLOCK_INVALID`, a configuration error, and name the call the clock was given to.

| host code | before | now |
| --- | --- | --- |
| `createTemporalCalendar(Temporal, { now: () => NaN })`, then `today` | = Invalid Date, Invalid Date | refused: The clock given to createTemporalCalendar answered NaN, which is not a moment in time, so today and now cannot be read. It should return the current moment in epoch milliseconds. |
| `createTemporalCalendar(Temporal, { now: 5 })` | built; `today` failed with UNEXPECTED_ERROR: this.clock is not a function | refused when built: The clock given to createTemporalCalendar is 5, not a function, so today and now cannot be read. It should return the current moment in epoch milliseconds. |
| `createTemporalCalendar(Temporal, { now: () => 1000.9 }).now()` | 1000.9 | 1000, truncated as `Date` truncates |

A line that does not read the clock does not need it, so a bad clock fails only `today`, `now` and the lines counted from them, and the rest of the document evaluates; both document passes agree. A backend given no clock reads `Temporal.Now` as before, unchecked, since the runtime's own clock always answers a moment.

The boundary: the check is on what the clock answers, not whether it is right. A clock pinned to a fixed moment, or one that runs backwards, is the host's choice and is used as given.

## Verification

`Issue826_temporalClockChecked.spec.ts` holds 30 tests, the `Date` backend's clock cases from `Issue721_engineFormatValue.spec.ts` run against each backend: a pinned clock, seven bad readings and four clocks that are not functions, the wording of both refusals, no clock at all, truncation, a clock that throws a hostile object (with `Object.prototype` untouched), a bad clock through both document passes on both backends, and the epoch, negative zero and both ends of the range.

The date and time suites ran under the `Temporal` backend in Europe/London, America/New_York and Pacific/Auckland (3,321 tests in 95 suites each, this spec included), and the full suite (`npm run test:full`, 20,448 of 20,452 tests in 671 suites, 4 skipped), `npm run typecheck`, `typecheck:tests`, `lint`, `lint:messages` and `lint:error-codes` passed. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
