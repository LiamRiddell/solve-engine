---
"solve-engine": patch
---

A timecode answers in the notation it was written in, `01:02:03:04 at 30 fps`, and no longer shows the engine's internal unit name

A timecode is held as its frame count under the unit `timecode@<fps>`, and nothing displayed that unit as a timecode, so the generic amount-and-unit rendering showed the count under the internal name. The way back from a frame count answered text instead of a timecode, so it took no arithmetic, and a timecode converted only to frames: `in seconds` was a parse error, and the refusals around a timecode named `timecode@30` (#759).

| line | before | now |
| --- | --- | --- |
| `01:02:03:04 at 30 fps` | 111,694.00 timecode@30 | 01:02:03:04 at 30 fps |
| `01:02:03:04 at 30 fps + 10` | 111,704.00 timecode@30 | 01:02:03:14 at 30 fps |
| `(111694 frames at 30 fps) + 1` | refused as text plus a number | 01:02:03:05 at 30 fps |
| `01:02:03:04 at 30 fps in seconds` | throws `Expected "frames" after "in"` | 3,723.13 seconds |
| `(01:02:03:04 at 30 fps) as timespan` | `"as timespan" needs a duration, got timecode@30` | 1 hour 2 minutes 3.133 seconds |
| `(01:02:03:04 at 30 fps) to seconds` | `Cannot convert timecode@30 to seconds: they do not measure the same thing` | 3,723.13 seconds |
| `01:02:03:04 at 30 fps + 5 kg` | five frames on | refused: a timecode moves by frames or a length of time, not by a mass |

The text reads back in as the same timecode, which is why it carries its rate. A timecode moved back past zero is shown with a minus sign (`-00:00:00:10 at 30 fps`), and a count that is not a whole number of frames, such as half a second added at 25 fps, is shown as the count (`90012.5 frames at 25 fps`), since rounding it to a frame would show a timecode the value is not. A timecode converts to any unit of time as its frames over its rate, so at 29.97 fps the seconds are the real time the frames take. The refusals that could meet a timecode name it as one (`timecode at 30 fps`), and the worker DTO carries a timecode as `unit: "frames"` with a new `timecodeFps` field, so a host never receives the internal name either.

The boundary: drop-frame timecode is still not implemented, as before. Two timecodes at different rates are still not combined, and `as timecode` is not added: a frame count at a rate is the timecode already. The time page's frame-rate examples are now proven against these answers.

## Verification

`Issue759_timecodeDisplay.spec.ts` holds 127 tests: the issue's lines, the answer read back in, every path out of a timecode (conversions, arithmetic, refusals, the DTO) without the internal name, unit tests of `timecodeText`, `isTimecodeRate`, `timecodeSeconds`, `timecodeConverted`, `timecodeOperandRefused` and the message helpers with ordinary, boundary and hostile arguments, and the adversarial cases: prototype words as the conversion target, a long run of additions, a negative result, a fractional rate, a frame at the rate's limit, a duration in seconds added, two rates, and the numeric edges. The adversarial sweep gains a timecode template. The specs that pinned the old display (`VideoTimecode.spec.ts`, `DateTimeClockAndTimecode.spec.ts`, `Issue749_pixelDensityAndTypographicPoint.spec.ts`) now pin the new one.

Gates run: `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:keywords` passed, the proven docs examples passed (1,253 tests), and the fast suite passed, 27,594 of 27,598 tests in 780 suites with 4 skipped. The full suite, the temporal run and `npm run verify:ci` were not run for this change.

On top of main, the full suite ran 29,773 tests in 801 suites, all passing but 4 skipped once two package pages and one spec linked main's createQueryResolver section by its heading (in this change), and `npm run test:temporal` passed its 3,509 tests.
