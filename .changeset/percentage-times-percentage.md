---
"solve-engine": patch
---

A percentage times a percentage, a percentage divided by a number and a power of a percentage answer a percentage, so `10% * 20%` and `product of 10%, 20%` are 2% rather than 0.02, and `6% / 12` is 0.5%

A percentage is held as its fraction (0.1 for 10%), and `*`, `/` and `^` read it as that fraction and wrote a plain number. So a share of a share, which is itself a share, came back as a bare 0.02, `product of` (which multiplies with `*`) did the same, and a yearly rate divided by twelve was the fraction 0.005, which an amount then had added to it as half a cent rather than raised by as a share (in the table, `$1000 + monthly` was $1,000.00). Each of the three now keeps the percentage where the answer is still a share (`vm/PercentArithmetic.ts`): a percentage times a percentage, `of` between two percentages, a percentage over a plain number, and a percentage raised to a plain number. A percentage times a plain number keeps its documented reading, the share of that number (`50% * 30` is 15), and a share of an amount is still the amount.

| line | before | now |
| --- | --- | --- |
| `10% * 20%` | `0.02` | `2.00%` |
| `10% of 20%` | `0.02` | `2.00%` |
| `product of 10%, 20%` | `0.02` | `2.00%` |
| `10% / 2` | `0.05` | `5.00%` |
| `10% ^ 2` | `0.01` | `1.00%` |
| `rate = 6%`, `monthly = rate / 12`, `$1000 + monthly` | `0.01`, `$1,000.00` | `0.50%`, `$1,005.00` |
| `(-10%) ^ 0.5` | `NaN` | refused: `(-10%)^0.5 has no real value: a negative percentage to a fractional power has one only when the fraction's denominator is odd, as in (-8%)^(1/3).` |
| `10% / 0` | `∞` | refused: `This has no percentage: its value is not a finite number, which is what dividing by zero gives.` |
| `10% * 2` | `0.20` | unchanged |
| `50% * 30` | `15` | unchanged |
| `10% * $5` | `$0.50` | unchanged |
| `10% / 20%` | `0.50` | unchanged |

The boundary: `10% * 2` is still 0.2, a tenth of 2, because a percentage times a number is always the share of the number (that is what `100 * 40%` means, and the two cannot be told apart by size); `10% + 10%` or `(10% * 2) as %` doubles a rate. A percentage over a percentage is a plain ratio and a number over a percentage a plain number, as before. `10% ^ -1` is read as `1 / 10%`, a plain 10, since `^-1` is the reciprocal. A divisor carrying an uncertainty keeps its own arithmetic, so `10% / (2 +/- 0.1)` is still the plain 0.05 ± 0.0025: a percentage holds no uncertainty. A negative percentage to a fractional power is refused by name (`(-10%) ^ 0.5`, which answered NaN), and an odd root of one is a percentage.

## Verification

`FoundBug_percentageArithmetic.spec.ts` holds 82 tests across this fix and the two beside it (`percentage-sums-exact.md`, `sweep-of-a-percentage.md`): every product, quotient and power of a percentage on both single-line paths with its kind checked, the unchanged readings, the refusals over zero and of a negative root, a monthly rate through both document passes; unit tests of `percentageTimesPercentage`, `percentageOverNumber`, `percentageToPower`, `percentProduct`, `percentQuotient` and `percentPower` (ordinary, boundary and hostile arguments: zero, negative zero, a negative, a fraction with no short decimal, an infinity, NaN, an overflow, an uncertain or quantity divisor); and the adversarial cases (prototype words with `Object.prototype` unchanged, a product of fifty percentages, deep brackets, a huge power, a long sum, text edges and other-script digits, markup-shaped text, a dropped percent sign, a check and a what-if through a product, an edit, every numeric edge, 2^53 and the 34-digit limit, CRLF). The four pins in `FoundBug_aggregateOfPercentages.spec.ts` are now passing tests, `AdversarialFeatureSweep.spec.ts` gains six line forms and two document forms, and `CrossPathDocumentFeatures.spec.ts` three tests.

The fast suite ran across 873 suites (35,681 of 35,686 tests passed, 5 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:dispatch-size` (`executeBytecode` at 47,376 bytes, unchanged) passed, as did the proven docs examples, `NormaliserRulesRejectCheaply`, `CrossPathDocumentFeatures`, `AdversarialFeatureSweep`, every `FoundBug_*` spec and the error-code suites, with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. The vm and diagnostic-pipeline benchmarks, run twice before and twice after on the same tree, moved within their run-to-run noise. `npm run verify` as one command was not run.
