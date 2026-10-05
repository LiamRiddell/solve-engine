---
"solve-engine": patch
---

`sum(9:30, 10:15)` reads two clock times and answers as `total(9:30, 10:15)` does, instead of the parser's `Expected "," but found ":"`

A colon inside `sum(...)` is read as a range, because `sum` walks a range (`sum(x^2, 1:3)`), and a two-argument `sum` whose second argument held a colon was left to map-reduce's `sum(<element>, <list>)`. That read `9` as the element and stopped at its colon, so the reader saw the parser's wording (found bug, no issue). The element is worked out once for each item, so it is never a range: a first argument written with a colon of its own now makes the call the aggregate over its values, as three arguments or two plain values already did. The colons are then clock times, and the call is refused by name, as `total(9:30, 10:15)` is, since a time of day is a moment rather than an amount to add up.

| line | before | now |
| --- | --- | --- |
| `sum(9:30, 10:15)` | `Expected "," but found ":"` | `A date or time cannot be added: only numbers and quantities can.`, as `total(9:30, 10:15)` |
| `sum(1:3, 4:6)` | `Expected "," but found ":"` | the same refusal: `1:3` there is a clock time, as in `sum(1:3, 4)` |
| `sum(x^2, 1:3)` | `14` | `14` (unchanged) |
| `sum(x, 9:30)` | `429` | `429` (unchanged: the list is a range) |
| `sum(2 hours, 3 hours)` | `5 hours` | `5 hours` (unchanged) |

The boundary: only the first of two arguments decides. A colon in the list, `sum(x, 9:30)`, is still a range, and one inside a bracket in the element, `sum([1:3], 4)`, is not the element's own. A colon pair that is no clock time (`sum(24:00, 0:00)`, and `(24:00)` on its own) is still refused with the parser's wording; that is not specific to `sum` and is left for its own fix. `prod(9:30, 10:15)` has no aggregate reading and keeps its refusal.

## Verification

`FoundBug_sumOfClockTimes.spec.ts` holds 14 tests: the line through `evaluateLine`, `parseDocument` and `evaluateDocument`, its agreement with `total(9:30, 10:15)`, the forms that stay as they were, unit tests of the new `hasOwnColon` and `isMapReduceSum` and of the aggregate call rule (ordinary, boundary and hostile token runs), and adversarial cases from the kit (prototype words, a long list of times, a huge range, look-alike digits and markup, times from the lines above, a check, midnight and the end of the day, the numeric edges, CRLF). The adversarial sweep has the new template, and the map-reduce page has proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:docs`; the docs, hardening, integration and aggregate suites; and the fast suite. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
