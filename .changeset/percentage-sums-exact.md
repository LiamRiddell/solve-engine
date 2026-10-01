---
"solve-engine": patch
---

A sum, difference, total or average of percentages equals the percentage it shows, so `10% + 20% == 30%` and `sum(10%, 20%) == 30%` are true

A percentage is held as a double, and a sum of two was formed in doubles: 0.1 + 0.2 is 0.30000000000000004, which shows as 30.00% but is not the double 0.3 that `30%` holds, so `10% + 20% == 30%` was false while `check 10% + 20% == 30%` passed. Plain numbers have long been exact here (`0.1 + 0.2 == 0.3` is true), because a decimal carries its exact value beside its double. A percentage now gets the same exactness without a second value: its arithmetic is formed in base ten from the decimals the percentages were typed as (`percentSum`, `percentTotal` and their siblings in `vm/ExactDecimals.ts`), and the answer is the double nearest that decimal, which is the double the percentage written as that decimal holds. So `==`, `!=`, the orderings and `check` agree with what is shown, with no change to how a comparison reads a percentage. This covers `+` and `-` between percentages (and a percentage and a plain number, `30% + 0.4`), `*`, `/` and `^` where they answer a percentage, and the totals, averages, medians, spreads and weighted averages of percentages, on one line and down a column, a range, a section or a tag.

| line | before | now |
| --- | --- | --- |
| `10% + 20% == 30%` | `false` | `true` |
| `sum(10%, 20%) == 30%` | `false` | `true` |
| `30% - 10% == 20%` | `false` | `true` |
| `10% + 20% != 30%` | `true` | `false` |
| `(average of 10%, 20%, 30%) == 20%` | `false` | `true` |
| `(weighted average of 10% at 1, 20% at 3) == 17.5%` | `false` | `true` |
| `check 10% + 20% == 30%` | `✓` | unchanged, and now agrees with `==` |
| `[100, 200] + (10% + 5%)` | `[115.00, 230.00]` | `[115, 230]` |
| `sum(10%, 20%) of 200` | `60.00` | `60` |
| `0.1 + 0.2 == 0.3` | `true` | unchanged |

The boundary: this covers a percentage written with up to fifteen significant digits, which is every one a person types. A percentage worked out from a fraction with no end (`(1/3) as %`), a standard deviation of percentages, and an answer whose digits outgrow a double keep the double, as a plain number's do. The last two rows of the table above were whole numbers shown with two places, because the double behind them was a hair past the whole number.

## Verification

`FoundBug_percentageArithmetic.spec.ts` holds 82 tests across this fix and the two beside it: every comparison above on both single-line paths, `check` beside `==` (including `≈`), the document totals (`total above`, `average above`, `median above`, a line range, a tag, a section) through both passes; unit tests of `percentSum`, `percentTotal` and `percentWeightedMean` (ordinary, boundary and hostile arguments: negative zero, a cancelling pair, places that differ, a value with no short decimal, an infinity, NaN, a column of 10,000 values, zero weights); and the adversarial cases named in `percentage-times-percentage.md`, among them a chain of a hundred percentages compared with 100%. `FoundBug_listPercentage.spec.ts` and `FoundBug_aggregateOfPercentages.spec.ts` now expect the whole numbers above.

The fast suite ran across 873 suites (35,681 of 35,686 tests passed, 5 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:dispatch-size` (`executeBytecode` at 47,376 bytes, unchanged) passed, as did the proven docs examples, `NormaliserRulesRejectCheaply`, `CrossPathDocumentFeatures`, `AdversarialFeatureSweep`, every `FoundBug_*` spec and the error-code suites, with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. The vm and diagnostic-pipeline benchmarks, run twice before and twice after on the same tree, moved within their run-to-run noise. `npm run verify` as one command was not run.
