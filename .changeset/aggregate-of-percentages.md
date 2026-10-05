---
"solve-engine": patch
---

An aggregate of percentages answers a percentage, so `sum(10%, 20%)` is 30% rather than 0.30, and a percentage beside a plain number in an aggregate is refused by name

A percentage is held as its fraction, and the comma aggregates (`sum`, `total`, `average`, `mean`, `median`, `min`, `max`, the spread forms and their `of` spellings) read every value as a magnitude and wrote the answer as a plain number. So `sum(10%, 20%)` and `total of 10%, 20%` answered 0.30 where the reader wrote percentages, and a percentage beside a number was added as its fraction: `sum(10%, 100)` was 100.10. A set of percentages is now answered as a percentage, and a set mixing one with a number, an amount or a true or false value is refused (`AGGREGATE_PERCENTAGE_MIXED`, new), naming the percentage and the fraction it stands for. The test sits where every aggregate reads its values in one unit (`unifyQuantities`), so the comma forms, the document forms and `min` and `max` agree. A line range, `total above` and its siblings, a section total and a tag total refused a percentage line outright; they now gather percentages as the comma forms do, so a column of rates totals to a rate.

| line | before | now |
| --- | --- | --- |
| `sum(10%, 20%)` | `0.30` | `30.00%` |
| `total of 10%, 20%` | `0.30` | `30.00%` |
| `average of 10%, 20%` | `0.15` | `15.00%` |
| `max(10%, 20%)` | `0.20` | `20.00%` |
| `median of 10%, 20%, 40%` | `0.20` | `20.00%` |
| `stdev of 10%, 20%` | `0.05` | `5.00%` |
| `weighted average of 10% at 1, 20% at 3` | `0.18` | `17.50%` |
| `sum(10%, 100)` | `100.10` | refused: `A percentage (10%) and a number cannot be added together: a percentage is a share of an amount, not an amount of its own. ...` |
| `sum(10%, 5 m)` | `5.10 m` | refused, naming an amount in m |
| `max(10%, 0.5)` | `0.50` | refused, as above |
| `sum(10%, true)` | `1.10` | refused, naming a true or false value |
| `10%`, `20%`, `total above` | refused: `Line 2 is not a plain number or unit value` | `30.00%` |
| `10%`, `20%`, `average(line 1 : line 2)` | refused, as above | `15.00%` |
| `rate = 10% #a`, `rate2 = 20% #a`, `total of #a` | refused: `Line 1, tagged #a, is not a plain number or unit value.` | `30.00%` |
| `variance of 10%, 20%` | `0.0025` | refused: `A variance of percentages would be in percent squared, which is not a percentage. ...` |

The boundary: a variance of percentages has no percentage to answer in, so it is refused with the code a variance of kilograms uses, and the standard deviation gives the same spread as a percentage. `count of` counts percentages as it counts anything. A table column's summaries keep their refusal of a percentage cell, and a breakdown by tag still asks for numbers or quantities. `product of` multiplies with `*`, and `10% * 20%` is the fraction 0.02, so a product of percentages is unchanged and pinned as a known gap, as is the double behind `10% + 20% == 30%`, which is false, and a sweep of a line that answers a percentage, which lists the fractions. `percentText` moved to its own module, `vm/PercentText.ts`, so the list cells and the aggregates quote a percentage through the same function; `vm/MatrixUnits.ts` still exports it.

## Verification

`FoundBug_aggregateOfPercentages.spec.ts` holds 74 tests: every aggregate over percentages on both single-line paths, every refusal of a mix, the document forms (`total above`, the block questions, a line range, a section, a tag, a lone `sum`) through both passes, the table column's refusal kept, names from the lines above; unit tests of `percentageOperands`, `percentageMixRefused`, `percentageAnswer`, `isAggregateFigure`, the `percent` flag of `unifyQuantities` and the moved `percentText` (ordinary, boundary and hostile arguments: zero, negative zero, a negative, an overflowing percentage, NaN, a text and an error beside a percentage); the adversarial cases (prototype words with `Object.prototype` unchanged, a hundred percentages on a line and a 2,000-line column, a long sum, deep brackets, a huge power, text edges and other-script digits, markup-shaped text, a typo, a value from the line above, a check and a what-if through a total, an edit, every numeric edge, the largest doubles, CRLF); and four one-assertion `test.failing` pins for the gaps named above. `CrossPathDocumentFeatures.spec.ts` gains a column of percentages across entry points (3 tests), `AdversarialFeatureSweep.spec.ts` four line forms and two document forms, `Issue530_aggregateNonNumeric.spec.ts` now expects `total of 10%, 20%` to be `30.00%`, and `SectionAggregates.spec.ts` expects a section of `$450` and `20%` to be refused as a mix (`AGGREGATE_PERCENTAGE_MIXED`) rather than as a line that is not a number.

The fast suite ran across 872 suites (35,433 of 35,438 tests passed, 5 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:dispatch-size` (`executeBytecode` at 47,376 bytes) passed, as did the proven docs examples, `NormaliserRulesRejectCheaply`, `CrossPathDocumentFeatures`, `AdversarialFeatureSweep`, every `FoundBug_*` spec and the error-code suites, with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. `npm run verify` as one command was not run.

On top of main, the full suite ran 37,299 tests in 887 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,839 tests.
