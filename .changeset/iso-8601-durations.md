---
"solve-engine": minor
---

ISO 8601 durations are read as lengths of time: `PT1H30M` is 90 minutes, `P1D` a day, and `2026-01-31 + P1M1D` is March 1; `as iso8601` writes a length of time back as one

APIs, logs and calendar files write a length of time as an ISO 8601 duration, and pasted into a note it was an undefined variable, while the compact spelling a person types (`1h30m`) already worked. A normaliser rule now reads the grammar, `P[n]Y[n]M[n]W[n]DT[n]H[n]M[n]S`, into the same quantity the written-out parts make (#760).

| line | before | now |
| --- | --- | --- |
| `PT1H30M` | throws `Undefined variable: PT1H30M` | 90 minutes |
| `P1D` | throws `Undefined variable: P1D` | 1 day |
| `P1Y2M3DT4H5M6S` | throws `Undefined variable: P1Y2M3DT4H5M6S` | 36,993,906 seconds |
| `2026-01-01 + PT1H30M` | throws `Undefined variable: PT1H30M` | Thursday, January 1, 2026, 1:30:00 AM |
| `2026-01-31 + P1M1D` | throws `Undefined variable: P1M1D` | Sunday, March 1, 2026 |
| `P1H` | throws `Undefined variable: P1H` | refused: H is a time part, and time parts come after a T |
| `90 minutes as iso8601` | refused: as iso8601 writes a date | PT1H30M |

Added to or taken from a date, the parts are applied one at a time, largest first, as the standard means: the months move the month field, clamped to the month's last day as the engine always clamps, then the days move the day, then the time is elapsed time. Elsewhere the parts are added up and held in the smallest unit written, as `1h30m` is, so the calendar parts keep the unit table's lengths when converted: `P1M in days` is 30 days, as `1 month in days` is. A fraction is allowed on the last part only, with a point or a comma, and the comma is read the same under a comma-decimal locale. `as iso8601` writes a value in the unit it is held in, so the text reads back as the same length: `14 months` is `P14M`, `1.5 days` is `P1DT12H`, `26 hours` is `PT26H`, and a length too large to write with exact digits is refused by name (`AS_ISO8601_DURATION_TOO_LONG`).

The boundary: upper-case designators only, as the standard writes them, and the whole identifier must match, so `pt1h30m` stays a name, and so do `P`, `PT` and `P1`, which spell no part. A variable that happens to spell a duration, such as `P1D`, is shadowed by it. A spelling shaped like a duration (a `P`, then digits and designator letters only) that breaks the grammar is refused by name with `ISO_DURATION_MALFORMED` rather than read as a name. A duration held in a variable and added to a date later is one length at the table's sizes, as `1 month 1 day` is, so the calendar reading applies only where the duration is added to the date directly; changing that would mean a duration value that keeps its parts, which this change does not introduce. The time page gains the form, with proven examples.

## Verification

`Issue760_isoDurations.spec.ts` holds 250 tests: the issue's lines, the calendar parts on a date beside the written-out parts, the table lengths on conversion, `as iso8601` and its read-back, the malformed spellings and the names left alone, unit tests of `isIsoDurationShaped`, `readIsoDuration`, `writeIsoDuration`, `writeDurationInUnit`, the normaliser rule (spread, bracketed, joined decimals, refusal token) and the fault handler, and the adversarial cases: prototype words in the spelling and as a target, a long sum, a long spelling and a count past a double, deep brackets, a thousand lines, zero-width and direction characters, digits from other scripts, markup, a value from the line above, a check and a total, the two document passes, a German engine, CRLF, a leap day and a month end. The adversarial sweep gains an ISO 8601 duration template.

Gates run: `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:keywords` passed, the proven docs examples passed (1,253 tests), and the fast suite passed, 27,594 of 27,598 tests in 780 suites with 4 skipped. The full suite, the temporal run and `npm run verify:ci` were not run for this change.

On top of main, the full suite ran 29,773 tests in 801 suites, all passing but 4 skipped once two package pages and one spec linked main's createQueryResolver section by its heading (in this change), and `npm run test:temporal` passed its 3,509 tests.
