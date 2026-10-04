---
"solve-engine": patch
---

A savings goal reads `over 2 years` as it reads `in 2 years`, and a return on an infinite amount is refused rather than answered as NaN%

`how much per month to reach $10,000 over 2 years` was refused with `Expected "in", but found "over"`, while the same line with `in` answered, and `over` is how the loan and compound-interest forms already read a term. `over` now names the time the saving runs for too, and any other word, or none, is refused with the form shown (`SAVINGS_GOAL_SYNTAX`).

A return on investment divides the gain by what was put in, so an infinite amount invested was infinity over infinity: `(1/0) invested $1,500 returned` answered `NaN%`, pinned as a known open bug in the investments spec, and an infinite amount returned answered `Infinity%`. Both are refused by name now, and so is an infinite amount in an annual return.

| line | before | now |
| --- | --- | --- |
| `how much per month to reach $10,000 over 2 years` | refused at `over` | $416.67 |
| `how much per month to reach $10,000 over 2 years at 5%` | refused at `over` | $397.05 |
| `(1/0) invested $1,500 returned` | NaN% | refused: the amount invested is not a finite number |
| `$1,000 invested (1/0) returned` | Infinity% | refused: the amount returned is not a finite number |

The boundary: only `in` and `over` are read before the duration; `for 2 years` is refused with the form shown rather than guessed at. A `0/0` amount still answers NaN, as `0/0` does everywhere. The savings goals and investments pages show the new forms.

## Verification

The pinned `test.failing` in `Issue778_investments.spec.ts` now passes, so the two infinite-cost lines join the edge sweep and a named test asserts each refusal; the spec holds 222 tests. `Issue739_goalSeekBothSignsAndRange.spec.ts` covers `over`, `in`, a rate, months and the refusal, and `AdversarialFeatureSweep.spec.ts` sweeps both savings-goal slots and the amount invested. Gates run: the full suite (`npm run test:full`) passed, 22,120 of 22,124 tests in 685 suites with 4 skipped, as did `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
