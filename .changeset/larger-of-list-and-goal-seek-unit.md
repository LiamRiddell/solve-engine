---
"solve-engine": patch
---

`larger of 10 and 4 and 12` is 12, and goal seek answers in the unit of the value it solves for: `solve line 3 for price = £1,500` is £500.00

`larger of` and its sister phrases read two values and parsed the second at the lowest level, so a third `and` became the addition it also is and `larger of 10 and 4 and 12` answered 16. Goal seek probed its target line with plain numbers and answered a plain number, so an unknown that was an amount of money lost its currency, and a target in another unit of the same measure was compared by its bare magnitude (#835).

| line | before | now |
| --- | --- | --- |
| `larger of 10 and 4 and 12` | 16 | 12 |
| `smaller of 10 and 4 and 12` | 10 | 4 |
| `solve line 3 for price = £1,500` (price £200, line 3 `price * qty`) | 500 | £500.00 |
| `solve line 3 for deposit = £900` (the mortgage example in pounds) | 170,507.23 | £170,507.23 |
| `solve line 2 for d = 3000 m` (d 5 km, line 2 `d * 2`) | 1,500 | 1.50 km |

Each further `and` now brings in another value, folded through the same builtin, so `larger of`, `smaller of`, `greater of`, `lesser of`, `gcd of` and `lcm of` all take a list. Goal seek reads the unit its unknown has in the note (through a new `getVariable` on the line execution context), probes the line with candidates in that unit, reads the target in the unit the target line answers in, and gives its answer in the unknown's unit, exact to the cent for money. A target that measures something else, or is money in another currency, is refused with `GOAL_SEEK_TARGET_UNIT_MISMATCH` rather than compared by magnitude.

The boundary: an unknown that is a plain number stays one whatever the target's unit, since a count of items making a total in pounds is still a count (`solve line 3 for qty = £1,500` is 7.50). A target in another currency is refused rather than converted at an exchange rate. The phrases join their values with `and`; a list with commas is `max(...)` or `min(...)`. Goal seek still resolves only through the incremental pass, and the batch pass and the single line refuse it as before. The statistics and goal-seek pages gain proven examples, the functions and operators guide documents `context.getVariable` for package authors, and the cross-path suite pins a money, a searched and a unit goal seek through all three entry points.

## Verification

`Issue835_largerOfListAndGoalSeekUnit.spec.ts` holds 32 tests: the phrases with two, three and four values, each agreeing with the call form, sums and quantities as values, a value from the line above and a dangling `and`; goal seek on money through the closed form and the search, on a plain unknown, on a unit line with a target in the same and another unit, a target of another measure and another currency refused, and the batch and single-line refusals; unit tests of `unitOf`, `inUnknownUnit` and `targetInLineUnit`; and adversarial cases from the three sides (prototype words as the unknown, the values and the target's unit, a long list, a what-if over a solved money line through both passes, and the numeric corpus). The full suite (`npm run test:full`) passed, 20,277 of 20,281 tests in 666 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:keywords`, `lint:error-codes` and `lint:dispatch-size`. `executeBytecode` is 46,034 bytecode bytes on Node 22. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
