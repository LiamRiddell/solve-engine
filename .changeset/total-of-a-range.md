---
"solve-engine": patch
---

`total(1:3)` adds up the range, as `sum(1:3)` does

`total` is documented as `sum`'s synonym: `sum of` is `total of`, a line that is only `sum` or `total` totals the block above, and `sum(line 1 : line 4)` and `total(line 1 : line 4)` are the same span. Yet `total(1:3)` was refused with "write sum(1:3)". The map-reduce rule fused only the word `sum` before a bracket, and only `sum` opened a bracket in which `1:3` is a range rather than a clock time, so `total(...)` fell to the line-range call and its range was read as 1:03 AM (found bug, no issue). A one-argument `total(...)` now reads as `sum(...)` does.

| line | before | now |
| --- | --- | --- |
| `total(1:3)` | `In total(...), 1:3 is a clock time, not a range, and a time cannot be added up: ... To add up a range, write sum(1:3).` | `6` |
| `total(-2:2)` | the same refusal | `0` |
| `total([10, 20, 30])` | `Expected a line reference such as line 1, but found "["` | `60` |
| `a = [1, 2, 3]`, then `total(a)` | `Expected a line reference such as line 1, but found "a"` | `6` |
| `total(3:1)` | the clock-time refusal | `A range's min (3) cannot be greater than its max (1). Did you mean "1:3"?` |
| `total(1, 2, 3)` | `6` | `6` (unchanged) |
| `total(line 1 : line 3)` | the span's total | the span's total (unchanged) |

The boundary: only the one-argument form is `sum`'s. With commas, `total(1, 2, 3)` stays the aggregate over its values, so `total(9:30, 10:15)` is still refused as two clock times that cannot be added, rather than read as ranges. The element form, `sum(x^2, 1:3)`, is `sum`'s alone: `total(x^2, 1:3)` reads `x` as a name, as before. A single value, `total(5)`, is refused with `sum`'s message, which names `sum`, since the two share one reading. `average`, `mean`, `median` and `stdev` still refuse a range by name (`AGGREGATE_CALL_RANGE`), whose catalogue entry no longer lists `total(1:3)` among its examples.

## Verification

`FoundBug_totalOfARange.spec.ts` holds 26 tests: the line through `evaluateLine`, `parseDocument` and `evaluateDocument`, the spellings and the forms around it, unit tests of the new `isSingleArgumentCall` and of `isInsideRangeContext` and `mapReduceCallNormalizerRule` with `total`, and adversarial cases from the kit (prototype words, sized input, deep brackets, look-alike and markup text, a typo, a check, a what-if, a tag, the numeric and document edges, CRLF). `FoundBug_averageOfARange.spec.ts` pinned `total(1:3)` as refused; it now expects 6 beside `sum(1:3)`. The statistics and map-reduce pages have proven examples.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`; the docs, hardening, integration, normaliser and map-reduce suites.

The fast suite ran 31,651 tests in 827 suites: 31,645 passed, 5 were skipped, and the one failure was a pinned inflation line updated for the sum change, passing since. `npm run verify` and the bundled-consumer contract were not run.
