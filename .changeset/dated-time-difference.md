---
"solve-engine": minor
---

`time difference between` takes a date: `time difference between London and New York on 20 March 2027` is 4 hours

The gap between two places moves whenever either changes its clocks, so a meeting planned for March needs the March gap, not today's. The dated conversion already followed the clocks (`2pm London in Tokyo on 1 March 2027`), but `time difference between` answered only for now and refused a date (#697).

| line | before | now |
| --- | --- | --- |
| `time difference between London and Tokyo on 1 March 2027` | `Unexpected token after expression: "on"` | Tokyo is 9 hours ahead of London on March 1, 2027 |
| `time difference between London and New York on 20 March 2027` | `Unexpected token after expression: "on"` | London is 4 hours ahead of New York on March 20, 2027 |
| `time difference between Tokyo and Adelaide on 1 March 2027` | `Unexpected token after expression: "on"` | Adelaide is 1 hour 30 minutes ahead of Tokyo on March 1, 2027 |
| `time in Tokyo on 1 March 2027` | `Unexpected token after expression: "on"` | refused, naming the two forms below |

- **The dated gap.** An `on <date>` after the second place takes both offsets on that day. A date names a whole day, and on the day a place changes its clocks the gap changes partway through it, so the answer is the gap at noon in the first place named, which is clear of every clock change in use. Any expression that gives a date works (`on next friday`, `on today`); one that does not is refused as the dated conversion refuses it, and a day that does not exist (`on 29 February 2027`) says why.
- **`time in` and `date in` stay for now.** The clock as it is now, carried to another day, answers nothing useful, so `time in Tokyo on 1 March 2027` is refused with the two questions it usually means: a time converted on that day (`2pm London in Tokyo on 1 March 2027`), and the gap between two places on it.

The boundary: the undated `time difference between` is unchanged and still answers for the present moment. The dated answer reads one moment of the day; a question about the hour the clocks change is the dated conversion's, which refuses a time that did not happen or happened twice.

## Verification

`Issue697_datedTimeDifference.spec.ts` holds 37 tests on a pinned clock: dates either side of the US and UK changes and on the change days, a half-hour zone, a fixed offset, zones sharing an offset, agreement with the dated conversion on seven dates, the refusals of `time in` and `date in` with a date, and `on` clauses that are not dates.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
