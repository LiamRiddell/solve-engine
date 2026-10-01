---
"solve-engine": patch
---

`what is $300 and $50 from 2003` is refused in plain words, and points at the plus sign that joins amounts

`INFLATION_EXPECTED_FROM_OR_IN` was listed in the error code reachability spec as guarded, with no line able to reach it, but `what is $300 and $50 from 2003` reaches it (found bug, no issue). Its message was the parser's: `Expected "from <year>" or "in <year> worth in <year>" after "what is <amount>", but found "and"`. The code is now listed with that line, and the message names the two shapes, the word that stands where `from` or `in` goes, and, for `and`, the sum that does work. `what was $300 and $50 worth in 1965` was refused by the parser's own `Expected` wording too; it now answers with the same code and the `what was` shape.

| line | before | now |
| --- | --- | --- |
| `what is $300 and $50 from 2003` | `Expected "from <year>" or "in <year> worth in <year>" after "what is <amount>", but found "and"` | `an inflation question names its year straight after the amount, as in what is $300 from 2003 or what is $300 in 1990 worth in 2010, and here "and" comes after the amount: to adjust a total, join the amounts with a plus sign, as in what is $300 + $50 from 2003` |
| `what was $300 and $50 worth in 1965` | a parser refusal naming the expected keyword | `INFLATION_EXPECTED_FROM_OR_IN`, `... as in what was $300 worth in 1965, and here "and" comes after the amount: ... as in what was $300 + $50 worth in 1965` |
| `what is $300 + $50 from 2003` | `$629.96` | `$629.96` (unchanged) |

The boundary: `and` is still refused rather than read as a sum, since it also joins conditions and lists, and a guess here would adjust a figure the reader did not mean. Only the wording and the reachability listing change.

## Verification

`FoundBug_inflationFromOrInReachable.spec.ts` holds 9 tests: the line through `evaluateLine`, `parseDocument` and `evaluateDocument`, the `what was` shape, no parser wording from any refusal of the code, unit tests of the new `fromOrInRefusal` (ordinary, boundary and hostile tokens), and adversarial cases from the kit (prototype words and markup between the amounts, a long run of words, a check over the refusal, CRLF). `ErrorCodeReachability.spec.ts` lists the code as reachable, and the interest and inflation page proves the message.

Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`; the docs, errors and inflation suites; and the fast suite. `npm run verify` and the bundled-consumer contract were not run.
