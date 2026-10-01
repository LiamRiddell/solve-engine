---
"solve-engine": patch
---

`average(1:3)` and the other aggregate calls say that a colon there is a clock time, not a range, rather than ask for a line reference or average 1:03 AM

`average(1:3)` answered `Expected a line reference such as line 1, but found "1:3"`, and `mean(1:3)`, `median(1:3)` and `stdev(1:3)` said a date or time cannot be averaged. Each was true of what the engine had read and said nothing about what the reader wrote. A colon between two numbers is a range only as the list of `sum`, `prod`, `map` and `reduce`, which is why `sum(1:3)` is 6; everywhere else it is a clock time, so `average(1:3)` reached the line-range call as 1:03 AM, and `mean(1:3)` reached the aggregate as a time.

The aggregates keep that reading rather than take a range: they refuse a bracketed list (`mean([1, 2, 3])`), and a range is a list, so averaging only the range would leave the list refused beside it. A call whose only argument is written like a range is now refused by name with `AGGREGATE_CALL_RANGE`: what the colon is there, where it is a range, and the spelling that answers.

| line | before | now |
| --- | --- | --- |
| `average(1:3)` | Expected a line reference such as line 1, but found "1:3" | In average(...), 1:3 is a clock time, not a range, and a time cannot be averaged: a colon between two numbers is a range only as the list of sum, prod, map or reduce. To average numbers, list them with commas, as in average(1, 2, 3). |
| `mean(1:3)` | A date or time cannot be averaged: only numbers and quantities can. | In mean(...), 1:3 is a clock time, not a range, ... |
| `total(1:3)` | Expected a line reference such as line 1, but found "1:3" | In total(...), 1:3 is a clock time, not a range, and a time cannot be added up: ... To add up a range, write sum(1:3). |
| `average(1, 2, 3)` | 2 | unchanged |
| `average(line 1 : line 3)` | the lines' average | unchanged |

The boundary: only a call with that one argument is refused this way. `average(1:3, 4)` has two arguments, and its first is still a time, refused as one; `max(9:30, 10:15)` compares two times as before.

## Verification

`FoundBug_averageOfARange.spec.ts` (19 tests) holds the lines above through all three entry points, unit tests of `rangeShapedArgument` (a signed clock time, a bare colon, several arguments, a time with seconds or a meridiem, a colon inside a nested call or list, a line that ends inside the call, a twenty-thousand-token call) and `aggregateRangeRefusal` (each aggregate's words, prototype words as the name), and the adversarial sides: a huge range, deep brackets, prototype words as either bound, every text and numeric edge, the bound from the line above, and the document edges. `AGGREGATE_CALL_RANGE` is in the catalogue snapshot and the reachability spec, the adversarial sweep gains the aggregate forms, and the statistics page shows the refusal as a proven example.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`; the docs, hardening, integration, packages and bugs suites, and the fast suite. `npm run verify` and the bundled-consumer contract were not run.
