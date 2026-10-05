---
"solve-engine": patch
---

A time difference measured on a stated day keeps that day when the answer is turned into JSON or copied, so a host reading `toJSON()` sees which day the gap belongs to

`time difference between London and Tokyo on 2026-03-10` is a gap of 9 hours, because London has not yet moved its clocks on that day, while on 10 July it is 8. The answer carries the two places and the day in its `zoneDifference`, and the formatter shows the day beside the gap. `toJSON()`, and every copy of the value, wrote the two places and left the day out, so a host that stored or sent the answer lost the one detail that explains why the gap is 9 rather than 8.

| call | before | now |
| --- | --- | --- |
| `toJSON()` of `time difference between London and Tokyo on 2026-03-10` | `zoneDifference: { from: "London", to: "Tokyo" }` | `zoneDifference: { from: "London", to: "Tokyo", on: "March 10, 2026" }` |
| `toJSON()` of `time difference between London and Tokyo` | `zoneDifference: { from: "London", to: "Tokyo" }` | unchanged |

The boundary: an undated gap still carries no `on` key at all, rather than one set to nothing, so a host comparing JSON from before and after sees no change there. A time of day moved past the calendar's range is refused as before, and the refusal no longer has a precision attached to it.

## Verification

`Issue757_zoneAnswersAsValues.spec.ts` gains a test of `toJSON()` on a dated gap, and unit tests of `copyZoneDifference` with a dated, an undated, an explicitly undefined and an empty day, and with prototype words, `Object.prototype` unchanged afterwards.

On top of main, the full suite ran 37,299 tests in 887 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,839 tests.
