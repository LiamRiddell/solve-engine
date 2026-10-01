---
"solve-engine": patch
---

A percentage added to an unknown is a share of it, so `foo + 10% =>` is `1.1foo`, as `200 + 10%` is 220

A percentage is a share of something. Added to a number it is a share of that number: `200 + 10%` adds a tenth of 200. Added to an unknown under the arrow, it added its bare fraction instead, so `foo + 10% =>` answered `foo+0.1`. The two are different formulas, and the difference reached real answers: a formula `y = x + 10%` answered 200.10 once `x` was 200, where `200 + 10%` is 220, and `solve(x + 10% = 220, x)` answered 219.9 (found while fixing an unknown under the arrow). A percentage on the right of an unknown now scales it, as it scales a number, so `foo + 10%` is `1.1foo` and `foo - 10%` is `0.9foo`.

| line | before | now |
| --- | --- | --- |
| `foo + 10% =>` | `foo+0.1` | `1.1foo` |
| `foo - 10% =>` | `foo-0.1` | `0.9foo` |
| `y = x + 10%`, `x = 200`, then `y` | `200.10` | `220` |
| `solve(x + 10% = 220, x)` | `219.9` | `200` |
| `x + 10% = 220`, then `x =>` | `219.9` | `200` |
| `10% + foo =>` | `foo+0.1` | `foo+0.1` |
| `foo * 10% =>` | `0.1foo` | `0.1foo` |

The boundary: a percentage written first keeps the reading a percentage plus a number has, a proportion (`10% + 5` is 510%), so `10% + foo =>` stays `foo+0.1`, the same value. An unknown that later turns out to hold a percentage itself is still read as a number by the formula, as every unknown is. A percentage with a unit after it (`foo + 10% km`) is refused as a unit in a formula is.

## Verification

`FoundBug_percentOfAnUnknown.spec.ts` holds 74 tests: a share added and taken away, the formula answering what the line with a number answers on both document passes, `solve` and an equation line, a formula in brackets, a coefficient, compounding, a negated unknown and a function, and the boundary of a percentage written first; unit tests of `symbolicPercentChange` (ordinary, zero, negative zero, all of it taken away, a negative share, a value that is not a formula, NaN and infinities, an error operand, prototype words, the largest and smallest doubles); and the adversarial cases (prototype words with `Object.prototype` unchanged, a long run of percentages, deep brackets, look-alike percent signs, text edges, markup, a share from the line above with a check and a what-if, a quantity, an edit, every numeric edge, a share that is nearly nothing, CRLF). `AdversarialFeatureSweep.spec.ts` gains `foo + X% =>`, `foo - X% =>`, `solve(x + X% = 220, x)`, a stored share over the numeric edges, and the prototype-word form.

The fast suite (`npm run test:ci`), `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the docs, hardening and integration suites passed; the counts are in the verification of the formula display entry of this release. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
