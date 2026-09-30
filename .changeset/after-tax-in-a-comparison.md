---
"solve-engine": patch
---

`after tax` takes the amount before it and stops at a comparison, so `check £50,000 after tax > £30,000` compares the take-home with £30,000 without brackets

The postfix payroll forms (`after tax`, `per month after tax`, `after 20% tax`) bound at a comparison's own power. A check reads each of its sides at that power, so the left side stopped short of `after tax` and the check refused the line for having no comparison; on the right of a comparison the phrase was left over for the whole line, so `£50,000 == £50,000 after tax` took the comparison as the salary and refused a boolean for not being pounds. Brackets were the only way round it. The forms now bind one step above a comparison and still below a sum, so the sum before the phrase is the salary and a comparison beside it is not.

| line | before | now |
| --- | --- | --- |
| `check £50,000 after tax > £30,000` | refused: a check compares two things | `✓` |
| `check £30,000 < £50,000 after tax` | refused: needs a pound salary | `✓` |
| `£50,000 == £50,000 after tax` | refused: needs a pound salary | `false` |
| `check £50,000 after 20% tax == £40,000` | refused: a check compares two things | `✓` |
| `£50,000 + £2,000 after tax` | `£40,717.40` | `£40,717.40` |
| `£50,000 after tax > £30,000` | `true` | `true` |

The boundary: only a comparison is released from the phrase. Everything that binds tighter, a sum, a product, a shift, stays part of the salary as before, so `2 * £50,000 after tax` is still the take-home on £100,000, and a bracketed check reads as it did. The payroll page gains a section on the phrase beside a sum or a comparison.

## Verification

`FoundBug_afterTaxInAComparison.spec.ts` holds 17 tests: the lines that exposed it through `check`, `≈ within`, a case clause, the monthly and stated-rate forms and a bare comparison; the sums that must stay the salary; unit tests of `PAYROLL_POSTFIX_BINDING_POWER` against the comparison, shift and sum powers and of every postfix parselet the package registers; and the adversarial cases (prototype words as the salary with `Object.prototype` unchanged, markup after the check, a chain of 500 comparisons, a long sum as the salary, a salary from the line above with a what-if through the check in both document passes, a typo, a dollar salary, and every numeric edge on each side). `AdversarialFeatureSweep.spec.ts` gains two forms.

The fast suite ran across 767 suites (25,907 of 25,912 tests passed, 4 skipped); its one failure was `LlmsTxt.spec.ts`, since the pages changed, and it passes after `docs/public/llms-full.txt` was regenerated. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and the proven docs examples passed, and `executeBytecode` measured 44,322 bytes by hand, unchanged (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.
