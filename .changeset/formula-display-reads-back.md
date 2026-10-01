---
"solve-engine": patch
---

A formula is shown in a form that reads back as itself: `solve(salary/1200 * rate = net, rate)` is `1200*net/salary`, not `net/(1/1200salary)`

A formula the engine shows should be one a reader can type back and get the same formula. Several were not. `solve(salary/1200 * rate = net, rate)` printed `net/(1/1200salary)`, which reads as one over 1200 salaries, and `-1/1200*rate*salary/-1 =>` kept its two minus signs. The engine reads a leading minus as part of what follows, so `-x^2` is `(-x)^2`, and the printer wrote the negative of a square, `-(x^2)`, as `-x^2`. A number written beside text it cannot stand beside changed the formula: `0.5` beside `-2*y` became a subtraction, `5sin(x)` and `0x` did not parse, `3` beside `2^x` read as thirty-two, and `1200` beside `net` read as the whole number `1200n`. A fraction in a denominator, under a power or before a further division lost its grouping, and `x^2/3/27` read as a date. And an exact fraction the arithmetic had computed, `x*(1/3)`, joined a formula as its double and printed as the rounded `0.3333333333x` (found while fixing an unknown under the arrow).

The printer now writes a fraction with no short decimal after its term as a division (`salary/1200`, `2x/3`), brackets a minus before a power, a minus or a fraction in a denominator and a fraction under a power, keeps three numbers over each other from reading as a date, and puts a `*` between a coefficient and anything it cannot stand beside. The simplifier cancels a double negative, folds `/-1`, turns a quotient under a quotient over (`x/(1/y)` is `x*y`), moves a fractional coefficient out of a denominator, and skips multiplying out a quotient by a constant, which has nothing to cancel (a formula a thousand levels deep took over half a second at that step and now takes a tenth of that). An exact fraction joins a formula as itself, and a fraction too large to show as one keeps ten significant figures rather than ten decimal places.

| line | before | now |
| --- | --- | --- |
| `solve(salary/1200 * rate = net, rate)` | `net/(1/1200salary)` | `1200*net/salary` |
| `solve(net = salary * 1200, salary)` | `-net/-1200` | `net/1200` |
| `solve(net = rate*salary/1200, salary)` | `-net/-1/1200rate` | `1200*net/rate` |
| `x/(1/y) =>` | `x/(1/y)` | `x*y` |
| `x/-1 =>` | `x/-1` | `-x` |
| `-x/-y =>` | `-x/-y` | `x/y` |
| `-(x^2) =>` | `-x^2`, which reads back as `(-x)^2` | `-(x^2)` |
| `x*(1/3) =>` | `0.3333333333x` | `x/3` |
| `integral(x^2, x)` | `1/3x^3` | `x^3/3` |
| `taylor(exp(x), x=0, 4)` | `1/24x^4+1/6x^3+0.5x^2+x+1` | `x^4/24+x^3/6+0.5x^2+x+1` |
| `y = x + 1`, then `y * 2` | `(x+1)*2` | `2(x+1)` |

The boundary: the printer knows no units, so a name that is also a unit is still written beside its coefficient, and `2b` typed back is two bytes; the documented `1+2+b+3+b =>` answer `2b+6` is unchanged. A fraction whose parts are over a million is shown as its decimal, to ten significant figures, which reads back close to it rather than exactly. A complex coefficient (`1/3i`) is written as before. Four existing tests pinned the old display (`Calculus.spec.ts`, `NumericCalculus.spec.ts`, `AlgebraSurface.spec.ts`, and `Issue732_storedFormulaReadsLaterValues.spec.ts`, whose `2nosuchname` read back as the whole number `2n`), one pinned `a/(b/c)` (`SymbolicNumericVerification.spec.ts`, now `a*c/b`), one pinned `x*(1/3)` as the decimal boundary (`SymbolicPhaseA.spec.ts`), and `FoundBug_equationWithSeveralUnknowns.spec.ts` pinned the Calca formula; each now asserts the new form. The reachability example for `SYMBOLIC_FACTOR_LIMIT_EXCEEDED` relied on `1/735134400` arriving as a long decimal, which it no longer does, and is now `factor(735134400x^2 - 25626846353)`.

## Verification

`FoundBug_formulaDisplayRoundTrip.spec.ts` holds 36 tests: the reported solves and simplifications, fractions after their terms, a minus before a power, and each display read back as itself; unit tests of `absorbNegation` (ordinary, nothing to cancel, a sign deeper than the search), `reshapeQuotient` (each rewrite keeping its value and node count, plain denominators, prototype words), `leadsWithPower` (ordinary, a power belonging to a later operand, empty, unclosed brackets, ten thousand brackets, a hundred-thousand-letter name), `formatSymbolic` on shapes the simplifier never builds, `formatRational`'s small fallback and `valueToSymbolic` with an exact fraction; the round trip over three seeds of 2,500 generated formulas each at one point and 1,500 more at a second, raw and simplified (those with no value at the point skipped), with the simplifier's idempotence and no-growth promises checked over the same formulas; and the adversarial cases (prototype words as names round-tripping with `Object.prototype` unchanged, a formula two thousand levels deep, a wide formula near the size guard, a look-alike name, a solved formula pasted back into a note, a stored formula on both document passes, zero, negative zero, 2^53 and a coefficient of 10^15, an empty arrow). `AdversarialFeatureSweep.spec.ts` gains `solve(net = rate * salary / X, salary)`, `-(foo^X) =>` and `foo / (1/X) =>`.

The fast suite ran 30,569 tests in 813 suites with this batch's five fixes (30,564 passed, 4 skipped, 1 failed: `Issue732_storedFormulaReadsLaterValues.spec.ts` pinned `2nosuchname`, which now prints `2*nosuchname`; the pin was updated and that spec and the five new ones, 2,546 tests, then passed). The five new specs hold 397 tests. `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, and the docs, hardening and integration suites (11,904 tests in 101 suites) passed, and the dispatch-loop size check read 45,980 bytecode bytes (the script's own command run by hand). `npm run verify` as one command, the bundled-consumer contract, the lexer fuzz suites and the benchmarks were not run.
