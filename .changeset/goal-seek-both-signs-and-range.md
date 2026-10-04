---
"solve-engine": minor
---

Goal seek searches negative inputs as well as positive ones, reports every crossing it finds, and takes a stated range: `solve line 2 for x = 4 between 0 and 10`

Goal seek searched only positive inputs, from 1e-9 to a billion, with a single bisection over that fixed bracket. A target only a negative input reaches had no solution, even where `solve(...)` found it at once, and a line that is not finite at the top of the bracket failed outright, because the first non-finite sample was returned as the answer: `2^x` could not be driven even to 4 (#739). The search now looks from minus to plus a billion, treats a sample that fails or is not finite as a gap in the scan, reports every crossing as `solve(...)` does, and accepts a range after the target.

| line | before | now |
| --- | --- | --- |
| `x + sin(x)`, `solve line 2 for x = -2` | refused: stays on one side between 1e-9 and 1000000000 | -1.11 |
| `2^x`, `solve line 2 for x = 4` | refused: not finite when x is 1000000000 | 2 |
| `2^x`, `solve line 2 for x = 0.25` | refused: not finite when x is 1000000000 | -2 |
| `x^2`, `solve line 2 for x = 4` | 2 | [-2, 2] |
| `x^2`, `solve line 2 for x = 4 between 0 and 10` | refused at `between` | 2 |
| `x^3 - x`, `solve line 2 for x = 0` | 1 | [-1, 0, 1] |
| `1/x`, `solve line 2 for x = 0` | 1,000,000,000 | refused: no value found between -1000000000 and 1000000000 |

Three mechanisms are tried in order. A closed-form line is still inverted exactly, and each root is now checked by one re-run of the line, so a reading the line itself cannot run (squaring money, say) gives the line's own refusal rather than an answer. A formula the algebra cannot invert is searched for crossings the way `solve(...)` searches it, without re-running the line. A line with no formula to read, such as a finance form, is re-run at forty inputs spread across the range (dense near zero) and each bracketed crossing narrowed in on by the Illinois method, which a curved line cannot stall. The scan and the narrowing share `vm.maxGoalSeekIterations`, a hundred re-runs by default, and each re-run is charged to the pass as before; a refusal about the pass or the line (the pass budget, a what-if in the target) ends the search at once rather than being retried.

A range is `between <low> and <high>` after the target, in either order, in plain numbers or in the unknown's unit or another unit of its measure. Several answers read as a list, `[-2, 2]`. A list does not carry a unit, so an unknown in one with several answers is refused with each value named (`GOAL_SEEK_SEVERAL_SOLUTIONS`), and a range chooses; more than ten are declined as a repeating line (`GOAL_SEEK_TOO_MANY_SOLUTIONS`), and a range that is not two different finite numbers is `GOAL_SEEK_RANGE_INVALID`. A target in metres or days followed by `between` was read as the date form `m between ... and ...`; a unit straight after a number is now that quantity's unit there, so the date form is read only where it starts an expression.

The boundary: a search finds crossings. A target the line only touches, or two crossings closer together than the scan's samples, can be missed, and that is reported as nothing found in the range searched, with the range named and a narrower one suggested, never as proof there is no answer. A finance line whose rate may go negative can now meet a target at a negative rate, which is the arithmetic's answer; a range excludes it. `parseDocument` still refuses every goal seek, since the batch pass cannot re-run a line. The goal-seek page is rewritten around the three mechanisms, with proven examples of both signs, several answers, a range and the refusals.

## Verification

`Issue739_goalSeekBothSignsAndRange.spec.ts` holds 58 tests: the issue's documents against `solve(...)`; several crossings, a range choosing among them, a repeating line and an unknown in a unit; a stated range excluding the root, reaching past the default, in another unit, and malformed; the issue's adversarial shapes (a pole, a repayment on a negative deposit, a target reached at 0, a jump, a line non-finite across the range, a line that fails everywhere); the entry points; unit tests of `goalSeekHandler` over a stub line (both signs, two crossings, a gap beside a root, the cap at 4, 1, 0, a negative and NaN, a pass refusal, a pending answer, text, money with several answers, the default range's ends, the largest and smallest doubles, a closed form the line disagrees with), of `readGoalSeekRange`, `scanGrid` and `solveClosedForm`; the unit before `between`; and prototype words, a huge range and target, a check and a tag, and the numeric edges. `CrossPathDocumentFeatures.spec.ts` gains the three-path shape, `AdversarialFeatureSweep.spec.ts` three templates, `ErrorCodeReachability.spec.ts` a line for each new code, and the quadratic in `GoalSeekBoundedSearch.spec.ts` now expects both roots. Gates run: the full suite (`npm run test:full`) passed, 22,120 of 22,124 tests in 685 suites with 4 skipped, as did `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar`. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
