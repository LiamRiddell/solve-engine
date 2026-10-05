---
"solve-engine": patch
---

A salary below zero is refused by name, so `-£50,000 after tax` no longer answers `-£50,000.00`

Every band charges nothing below its threshold, and a pension takes nothing from a salary of zero or below, so a negative salary went through the take-home arithmetic untouched and came back as a take-home no one has. `per month after tax`, `after 20% tax`, `take home on` and `hourly for` did the same. Each payroll form now refuses a salary below zero with `PAYROLL_NEGATIVE_SALARY`, after the pound check, so a dollar salary is still refused for its currency first.

| line | before | now |
| --- | --- | --- |
| `-£50,000 after tax` | `-£50,000.00` | refused: a salary is what someone is paid, so it cannot be below zero |
| `-£50,000 per month after tax` | `-£4,166.67` | refused, the same |
| `-£50,000 after 20% tax` | `-£40,000.00` | refused, the same |
| `hourly for -£50,000` | `-£26.04` | refused, the same |
| `£0 after tax` | `£0.00` | `£0.00` |
| `-$50,000 after tax` | refused: the bands say nothing about USD | refused: the bands say nothing about USD |

The boundary: zero is a salary (a year unpaid), and its take-home stays nothing. The refusal reads the salary the phrase applies to, so `£10,000 - £60,000 after tax` is refused while `-(£50,000 after tax)` is the negated take-home, `-£39,519.60`. A NaN salary is left to the arithmetic, as it was. The payroll page says why a negative salary has no take-home.

## Verification

`FoundBug_negativeSalary.spec.ts` holds 24 tests: every payroll form over a negative salary, zero and the ordinary salaries unchanged, the order against the currency, rate and clause refusals, a salary that is a sum, unit tests of `negativeSalaryRefusal` (ordinary, negative zero, the smallest and largest doubles, NaN and the infinities) and of each plugin function applying it, and the adversarial cases (prototype words as the salary with `Object.prototype` unchanged, a long negative sum within and past the line limit, deep brackets, text edges, look-alike minus signs, a salary from the line above with a what-if and a check through both document passes, a typo, and every numeric edge). `Issue747_payrollScotlandLoansPensions.spec.ts` pinned `-£5,000 after tax with 5% pension` as `-£5,000.00`, and now expects the refusal. `AdversarialFeatureSweep.spec.ts` gains `-£X after tax`, `hourly for -£X` and `-X after 20% tax`, and the new code is in the catalogue snapshot, the reachability spec and the error code reference.

The fast suite ran across 776 suites (26,551 of 26,555 tests passed, 4 skipped, none failed), with `docs/public/llms-full.txt` regenerated for the changed pages. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measured 44,186 bytes by hand (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.

On top of main, the full suite ran 29,773 tests in 801 suites, all passing but 4 skipped once two package pages and one spec linked main's createQueryResolver section by its heading (in this change), and `npm run test:temporal` passed its 3,509 tests.
