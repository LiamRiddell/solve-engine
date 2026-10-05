---
"solve-engine": patch
---

A span of time that rounds to no whole second is written `0:00`, never `-0:00`.

The gap between two clock readings is shown as a clock, rounded to the second, with a minus sign when the second reading is earlier. The sign was taken from the unrounded gap, so `now - now`, which reads the clock twice and can land a millisecond below zero, showed `-0:00`. The sign now follows the rounded span.

| expression | before | now |
| --- | --- | --- |
| `now - now` | `-0:00` (sometimes) | `0:00` |
| `9:30 - 8:30` | `1:00` | `1:00` |
| `8:30 - 10:00` | `-1:30` | `-1:30` |

The boundary: a span of half a second or more still rounds to a whole second and keeps its sign.

## Verification

`packages/engine/__tests__/format/FormatMsDuration.spec.ts` calls the formatter directly at zero, negative zero, a millisecond either side and the half-second boundary, and evaluates `now - now` fifty times. `FoundBug_dateDifferenceInDays.spec.ts` passes again.

On top of main, the full suite ran 31,617 tests in 823 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,666 tests.
