---
"solve-engine": patch
---

`tau`, `phi` and `golden ratio` work inside an equation, a derivative and a function body: `solve(x^2 = tau, x)` is `[-2.51, 2.51]`, and `2tau` is two times tau

A mathematical constant is a number with a name, and `pi` and `e` have always been read as their numbers wherever a number goes. The constants package read `tau`, `phi` and `golden ratio` through a plugin function instead, the way it reads `gravity` to attach its unit. Several forms compile part of a line on its own and run it more than once (the expression of `solve`, `der` and `integral`, a function body, a map transform), and each refuses a plugin call, since a plugin may answer from live data and those forms cannot wait for it. So `solve(x^2 = tau, x)` was refused with "solve's expression must be synchronous (no weather/stocks/currency calls)", a reason that had nothing to do with tau (found while testing the solver over pi). A constant with no unit is now pushed as its number, as `pi` is. Separately, the implicit multiplication that reads `2pi` as `2 * pi` knew only `pi` and `e`, so `2tau` was a parse error; the constants package now reads an amount or a closing bracket written against `tau`, `phi` or `golden ratio` as a product. The constant table is also read by its own keys only, so a name such as `constructor` can no longer find an inherited function and read it as a constant.

| line | before | now |
| --- | --- | --- |
| `solve(x^2 = tau, x)` | solve's expression must be synchronous (no weather/stocks/currency calls). | `[-2.51, 2.51]` |
| `solve(x^2 = phi, x)` | the same refusal | `[-1.27, 1.27]` |
| `solve(x^2 = golden ratio, x)` | the same refusal | `[-1.27, 1.27]` |
| `solve(x^2 = 2tau, x)` | Expected ",", but found "tau" | `[-3.54, 3.54]` |
| `2tau` | Expected an operator or the end of the line, but found "tau" | `12.57` |
| `2 golden ratio` | the same parse error | `3.24` |
| `der(tau*x^2, x)` | the same refusal as `solve`'s | `12.5663706144x` |
| `f(x) = x * tau`, then `f(2)` | "f(...)"'s body calls an async operation (weather, stocks, currency, ...), and a user-defined function body must be synchronous | `12.57` |
| `solve(x^2 = 2pi, x)` | `[-2.51, 2.51]` | `[-2.51, 2.51]` |

The boundary: a constant with a unit (`gravity`, `speed of light`) still has its unit attached by the plugin as the line runs, since a unit cannot be written into the compiled line the way a number can; that call is made synchronous by `unit-constant-in-a-held-expression.md`, in the same release. A bare amount before a dimensioned constant (`2 gravity`) is not read as a product either, since it could as well be read as a count of gravities: the `*` says which.

## Verification

`FoundBug_constantInAHeldExpression.spec.ts` holds 99 tests: the three constants inside `solve`, `2tau`, `2 phi`, `(1 + 1)tau` and `sqrt(2)tau` beside `2pi`, the golden ratio's own equation, `der`, `integral` and a function body, the dimensioned constants unchanged, and the equation through `evaluateLine`, `parseDocument` and `evaluateDocument`; unit tests of `inlineConstantValue` (each mathematical constant, every unit-bearing or marked one refused, an unknown name and the prototype words), `constantEntry` reading its own keys, `constantParselet` (a pushed number with no plugin call, `gravity` still calling the plugin) and `constantMultiplyNormalizerRule` (a number and a bracket before each constant, a physical constant, a name, the end of the line); and the adversarial cases (prototype words as the unknown and beside `2tau` with `Object.prototype` unchanged, two thousand terms and two hundred brackets in time, a Greek tau and a Cyrillic look-alike, text edges, markup, a typo, a unit-bearing constant in `solve`, the constant from the line above under a check and a what-if, a unit and a percent word after `2tau`, every numeric edge times tau and written against it, zero, a negative, CRLF). The one `test.failing` in `FoundBug_irrationalConstantRoots.spec.ts` (tau inside `solve`) now passes and is an ordinary test. `AdversarialFeatureSweep.spec.ts` gains `solve(x^2 = (X) * tau, x)` and `(X)tau`. Gates: see the verification of `tiny-value-shown-as-zero.md`, which ran for the whole batch.
