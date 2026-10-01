---
"solve-engine": patch
---

Only the list a `map`, `reduce`, `sum` or `prod` call works through reads a colon as a range: `prod(9:30, 10:15)` and `sum(x, [9:30, 10:15])` read clock times and are refused by name, not with the parser's wording

The normaliser read every colon between two numbers inside one of those calls, and inside every pair of square brackets, as a range (found bug, no issue). The first argument of a call is the expression worked out for each item, never a range, so `prod(9:30, 10:15)` parsed `9` and stopped at the colon with `Expected "," but found ":"`. A list's items are values, and no list ever read a range item, so `sum(x, [9:30, 10:15])` stopped at its first colon with `Expected "]" but found ":"`. Now only the collection of the call is a range context, and of the square brackets only a matrix slice, `m[0:1, 0:1]`, which follows a name. A colon pair in the first argument or in a list is a clock time, and each line is refused by what it asks: a time of day cannot be multiplied, and a list holds numbers.

| line | before | now |
| --- | --- | --- |
| `prod(9:30, 10:15)` | `Expected "," but found ":"` | `A date or time cannot be multiplied: it is a moment, not an amount. ...` |
| `sum(x, [9:30, 10:15])` | `Expected "]" but found ":"` | `A date or time cannot be a cell of a list: each cell holds one number.` |
| `prod(x, [9:30, 10:15])` | `Expected "]" but found ":"` | the same refusal |
| `max([9:30, 10:15])` | `Expected "]" but found ":"` | the same refusal |
| `sum([1:3])` | `Expected "]" but found ":"` | the same refusal: the item is the time 1:03 |
| `sum(x, 9:30)` | `429` | `429` (unchanged: the list is a range) |
| `prod(x^2, 1:3)` | `36` | `36` (unchanged) |
| `m[0:1, 1]` (with `m = [1, 2; 3, 4]`) | `[2; 4]` | `[2; 4]` (unchanged) |

`prod` has no reading as two values to multiply, so where `sum(9:30, 10:15)` answers as `total(9:30, 10:15)` does, `prod(9:30, 10:15)` is the element form with a time as its element, and is refused as a multiplied time.

The boundary: a list of clock times is refused rather than read, since a list holds numbers; a list of lengths of time, `sum(x, [1 hour, 30 min])`, adds up. A range is written without the brackets, `sum(1:3)`, and `[1:3]` is a list holding one clock time, as `(1:3)` is a clock time.

## Verification

`FoundBug_clockTimesInAMapReduceCall.spec.ts` holds 13 tests: the lines through `evaluateLine`, `parseDocument` and `evaluateDocument`; the forms that stay as they were (ranges as the collection, the element form, a third `reduce` argument, a matrix slice through both document passes); unit tests of the new `opensIndex` and the changed `isInsideRangeContext` with ordinary, boundary and hostile arguments (a position past the end of the line now answers false where it threw a `TypeError`); and adversarial cases from the kit (prototype words in each argument, a list of 2,000 times, a huge range, deep brackets, look-alike digits, invisible characters and markup, times from the line above, a check, midnight and the last minute, the numeric edges as a list item and as the element, CRLF). The adversarial sweep has the new templates, and the map-reduce page has proven examples. `NormaliserRulesRejectCheaply.spec.ts` compares the clock-time rule with answers recorded before an earlier change, and lists `[1:3]` as the one answer this fix changes on purpose.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`; the docs, hardening, integration, bugs, time, map-reduce, aggregate and inflation suites; and the fast suite. `npm run verify` and the bundled-consumer contract were not run.
