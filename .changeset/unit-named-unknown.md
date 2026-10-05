---
"solve-engine": patch
---

An unknown named like a unit is written so it reads back as itself: `b + b =>` is `2*b`, not `2b`, which is two bits

A formula writes a number straight before the name it multiplies, `2x`, which is how algebra is written and reads back as the product. A number straight before a unit is an amount of that unit, though, so an unknown called `b` printed as `2b` read back as two bits, `m + m =>` as `2m`, two metres, and `k + k =>` as `2k`, which the engine reads as two thousand, as it does `2million`. A slash before a unit means "per", so `0.5/m` read back as half of something per metre, and `x/m` was refused. The formula display was meant to read back as itself, and documented this as the exception (found while testing that display).

The printer now asks whether a number written before the name would read it as one of the engine's units or as a size word (`k`, `M`, `million`, `bn`), and writes such a name after a `*`. Typed back, `2*b` is the formula again, because a unit word with no number of its own in front of it is read as a name. A denominator that opens with a unit name is bracketed, `0.5/(m)`, for the same reason. Every other name keeps its coefficient beside it.

| line | before | now |
| --- | --- | --- |
| `b + b =>` | `2b`, which reads back as `2.00 b` | `2*b` |
| `1+2+b+3+b =>` | `2b+6` | `2*b+6` |
| `m + m =>` | `2m` | `2*m` |
| `k * 3 =>` | `3k`, which reads back as 3,000 | `3*k` |
| `der(b^3, b)` | `3b^2` | `3*b^2` |
| `solve(b*m = 4, m)` | `4/b`, which reads back as `4.00 /b` | `4/(b)` |
| `:a = 2`, `a*b*x = 10`, `x =>` | `10/(2b)` | `10/(2*b)` |
| `x + x =>` | `2x` | `2x` |

The boundary: the printer knows the units and size words built into the engine. A unit a note defines for itself (`1 sprint = 2 weeks`) is not known to it, so an unknown called `sprint` is still written `2sprint`, which reads back as two sprints. Seven existing tests pinned the old display (`SymbolicAlgebra.spec.ts`, `Symbolic.spec.ts`, `PipelineConsistency.spec.ts`, `Issue732_storedFormulaReadsLaterValues.spec.ts`, `FoundBug_productEquationUndefinedFactor.spec.ts`, and the documented `1+2+b+3+b =>` on the symbolic page and the cheatsheet); each now asserts `2*b`, and the page's opening example uses `x`. The entry for the formula display earlier in this release, which named this as its boundary, is corrected.

## Verification

`FoundBug_unitNamedUnknown.spec.ts` holds 104 tests: `b`, `m` and fifteen unit and size names printed with a `*` and read back as written, ordinary names beside their coefficient, a power, a product, a fraction and a negative, bracketed unit denominators, the algebra verbs, and the three entry points; unit tests of `readsAsAmountWord`, `leadsWithUnitName`, `isMagnitudeSuffix` and `juxtaposes` (ordinary, boundary, prototype words, look-alikes, a hundred-thousand-letter name in time); a round trip of short formulas in seven names; and the adversarial cases (prototype words with `Object.prototype` unchanged, a full-width look-alike, a sum of two hundred in time, text edges, markup, a note's own unit, a printed formula pasted below, a check and a what-if, every numeric edge as the coefficient, zero, negative zero, 2^53, 10^15, CRLF). `FoundBug_formulaDisplayRoundTrip.spec.ts` gains a round trip over generated formulas in `b`, `m` and `k` at two seeds, which found the `/m` reading; `AdversarialFeatureSweep.spec.ts` gains `(X) * b + b =>` and `(X) / m =>`.

The five specs of this batch hold 526 tests (84, 154, 114, 70 and 104), and the five specs of the previous symbolic batch, run beside them, 399 (`FoundBug_formulaDisplayRoundTrip.spec.ts` now 38). The fast suite ran 31,603 tests in 821 suites, 31,598 passed and 5 skipped (the test of the cubic near the largest double was added after that run and passed with its spec). A first run of it found four failures, each fixed before the run above: a cubic over a sum near the largest double took twenty seconds in the closed forms (now reported unsolved), two tests pinned old display (`SymbolicNumericVerification.spec.ts`'s `a*c/b`, now `a*c/(b)`, and `FoundBug_nonFiniteBaseConversion.spec.ts`'s hex of `2^1023 * 1.9`, now the exact value's digits), and a timing case in this batch's own spec. `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and `docs/public/llms-full.txt` (regenerated) passed, and the dispatch-loop size check read 45,980 bytecode bytes (the script's own command run by hand, with the worktree ignore removed). `lint:changeset` passed on the commit. `npm run verify` as one command, the bundled-consumer contract, the lexer fuzz suites and the benchmarks were not run.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
