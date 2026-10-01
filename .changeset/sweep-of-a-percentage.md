---
"solve-engine": patch
---

A sweep of a line that answers a percentage is refused by name, where it listed the fractions (`[0.10, 0.20, 0.30]` for 10%, 20% and 30%)

A sweep (`line 2 for rate from 10% to 30% step 10%`) answers with a list, and a list holds plain numbers, so a line whose answer was a percentage was listed as each share's fraction. The reader saw `[0.10, 0.20, 0.30]` under a line showing 10.00%. A list literal with a percentage in it is already refused for this reason (`LIST_PERCENTAGE_UNSUPPORTED`), so the sweep now refuses too (`SWEEP_ANSWER_PERCENTAGE`, new), at the first step that answers a percentage so the steps after it never run. The message names the step and the answer, and the form that sweeps: a line giving the answer as a number, such as its percentage points.

| line | before | now |
| --- | --- | --- |
| `r = 10%`, `z = r`, `line 2 for r from 10% to 30% step 10%` | `[0.10, 0.20, 0.30]` | refused: `With r at 10%, line 2 answers 10%, a percentage, and a sweep lists its answers in a list, which holds plain numbers, not percentages. To sweep it, add a line that gives the answer as a number, such as "line 2 * 100" for its percentage points, and sweep that line.` |
| `rate = 10%`, `rate * rate`, `line 2 for rate from 10% to 30% step 10%` | `[0.01, 0.04, 0.09]` | refused, as above, naming the answer 1% |
| `rate = 10%`, `rate * rate`, `line 2 * 100`, `line 3 for rate from 10% to 30% step 10%` | `[1.00, 4.00, 9]` | `[1, 4, 9]` |
| `rate = 4%`, `100 + rate`, `line 2 for rate from 10% to 30% step 10%` | `[110, 120, 130]` | unchanged |

The boundary: only the swept line's answer is refused. A percentage as the swept input is the common case and is unchanged, as is a line that turns it into a number or an amount. A sweep whose answers turn from a number to a percentage partway is refused at the step that first answers one. The single-expression path has no document to sweep and keeps its refusal.

## Verification

`FoundBug_percentageArithmetic.spec.ts` holds 82 tests across this fix and the two beside it: the refusal through both document passes, the percentage-points line that sweeps, the unchanged sweeps through a percentage input, the single-line refusal; unit tests of `sweepPercentageRefused` (ordinary, boundary and hostile arguments: a number input, a zero and a negative answer, a prototype word as the name, an answer too large to write); and the adversarial cases, among them a sweep whose answers change kind partway and a prototype word as the swept name. `CrossPathDocumentFeatures.spec.ts` gains the sweep across entry points (the refusal on both passes, an edit in a live editor, the single-line refusal), `AdversarialFeatureSweep.spec.ts` two document forms, and `ErrorCodeReachability.spec.ts` a line that produces the new code.

The fast suite ran across 873 suites (35,681 of 35,686 tests passed, 5 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:dispatch-size` (`executeBytecode` at 47,376 bytes, unchanged) passed, as did the proven docs examples, `NormaliserRulesRejectCheaply`, `CrossPathDocumentFeatures`, `AdversarialFeatureSweep`, every `FoundBug_*` spec and the error-code suites, with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. The vm and diagnostic-pipeline benchmarks, run twice before and twice after on the same tree, moved within their run-to-run noise. `npm run verify` as one command was not run.
