---
"solve-engine": patch
---

A colon pair that is no clock time is refused by name inside brackets, as it is on its own line: `(24:00)` answers `"24:00" is not a valid time`, not the parser's `Expected ")", but found ":"`

The clock-time rule reads a colon between two numbers as a time of day, and declines one that no clock can show (an hour past 23, a minute past 59, a decimal on either side). It left the colon as it was (found bug, no issue). On its own line the engine's label reading then refuses a colon between numbers with `INVALID_TIME_LITERAL`, but inside a bracket no label can stand, so the bracket met the colon where it wanted its `)` and the reader saw the parser's wording. A rule below every time rule now reads such a pair inside a bracket as one refused literal, and the parser refuses it with the same code and words, wherever it meets it: as a value, or where it needed another token.

| line | before | now |
| --- | --- | --- |
| `24:00` | `"24:00" is not a valid time` | unchanged |
| `(24:00)` | `Expected ")", but found ":"` | `"24:00" is not a valid time` |
| `total(24:00, 0:00)` | `Expected ")", but found ":"` | `"24:00" is not a valid time` |
| `sum(24:00, 0:00)` | `Expected ")", but found ":"` | `"24:00" is not a valid time` |
| `max(24:00, 1)` | `Expected ")", but found ":"` | `"24:00" is not a valid time` |
| `[24:00]` | `Expected "]", but found ":"` | `"24:00" is not a valid time` |
| `(13:00pm)` | `Undefined variable: pm` | `"13:00pm" is not a valid time` |
| `(2026-01-04 24:00)` | `Expected ")", but found "24"` | `"24:00" is not a valid time` |
| `average(24:30)` | `In average(...), 24:30 is not a range: ...` | unchanged |
| `sum(24:30)` | `189` | `189` (unchanged: the list of `sum` is a range) |

The boundary: only inside a bracket, and never where a colon is a range, the list that `sum`, `prod`, `map` or `reduce` works through and a matrix slice. At the top level of a line a colon may be a label's (`Week 12: 75` still answers 75), and the label reading already refuses a pair that stands alone. Two top-level shapes the label reading does not refuse are left as they are and noted for their own fix: `1 + 24:00` still reads `1 + 24` as a label and answers 0, and `1:23:99` reads the clock time `1:23` as a label and answers 99.

## Verification

`FoundBug_invalidClockTimeInBrackets.spec.ts` holds 17 tests: each line through `evaluateLine`, `parseDocument` and `evaluateDocument`; the forms that stay as they were (valid times, ranges, lap times, pace, a top-level label, the aggregate range refusal); unit tests of the new `isInsideBrackets`, `colonPairAt`, `invalidTimeMessage` and `invalidClockTimeNormalizerRule` with ordinary, boundary and hostile arguments; and adversarial cases from the kit (prototype words, a long list and deep brackets, a long run of colons, look-alike digits, invisible characters and markup, the end of a day from the line above, a check, the numeric edges as the hour, CRLF). `FoundBug_sumOfClockTimes.spec.ts` pinned `sum(24:00, 0:00)` as a thrown parse error and now pins the refusal. The adversarial sweep has the new templates, and the time page has proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`; the docs, hardening, integration, bugs, time, map-reduce, aggregate and inflation suites; and the fast suite. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
