---
"solve-engine": patch
---

A product equation asked for its unknown while a factor has no value names `solve(a*x = b, x)`, which gives the formula, as well as the missing factor

A product of names, `a*x = b`, is stored as an equation on sight, because whether its factors are matrices is only known when it is solved, and it is solved by multiplying out the factors' values. With `a` given no value, `x =>` answered `Cannot solve for "x": "a" is not yet defined.`, which is true and stopped there (found while fixing an unknown under the arrow). The solving-equations page promises the arrow for an equation with one unknown and refuses one with several by name, pointing at `solve`; it does not promise that the arrow derives a formula in the others, so falling back to `b/a` is not the documented behaviour. The message now names both ways forward, quoting the equation as it was typed: give the factor a value above, or `solve(a*x = b, x)`, which treats it as one more unknown and answers `b/a`. A stored product equation keeps its text for this (`EquationDef.text`, set by `defineEquation`'s new optional fourth argument).

| line | before | now |
| --- | --- | --- |
| `a*x = b`, then `x =>` | Cannot solve for "x": "a" is not yet defined. | Cannot solve for "x": "a" is not yet defined. Give "a" a value on a line above, or solve for "x" in terms of it with solve(a*x = b, x). |
| `solve(a*x = b, x)` | `b/a` | `b/a` |
| `a = 4`, `a*x = 10`, then `x =>` | `2.5` | `2.5` |
| `a = [1, 2; 3, 4]`, `a*x = [60; 70]`, then `x =>` | `[-50.00; 55.00]` | `[-50.00; 55.00]` |

The boundary: the arrow does not fall back to the formula on its own, since an arrow solves an equation for its one unknown and with `a` unknown this one has two. A factor that holds a plain number makes the line the scalar equation it also is, as before, so `:a = 2`, `a*b*x = 10`, `x =>` answers `10/(2*b)` with the remaining factor kept as an unknown (written after a `*`, since `b` is also the bit).

## Verification

`FoundBug_productEquationUndefinedFactor.spec.ts` holds 75 tests: the refusal through both document passes, the solve it names, the equation quoted as typed with its spaces and with three factors, a factor with a value (scalar and matrix) unchanged, the first missing factor named after a matrix, and the scalar boundary; unit tests of `undefinedFactorMessage` (ordinary, no text, empty and blank text, prototype words, markup) and of the text a `createVM()` and a scratch VM keep; and the adversarial cases (prototype words as the factor and the unknown with `Object.prototype` unchanged, a chain of 150 missing factors, a look-alike factor, markup, an edit, a factor defined between the equation and the arrow, a check and a what-if, a typo, every numeric edge on either side, CRLF, and the single-expression path). `CrossPathDocumentFeatures.spec.ts` gains the refusal and the solve through `parseDocument` and `evaluateDocument`, a live edit that gives the factor a value, and the single-expression path; `AdversarialFeatureSweep.spec.ts` gains `solve(a*x = X, x)`, the product equation with and without a factor over the numeric edges, and the prototype-word form.

The fast suite (`npm run test:ci`), `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the docs, hardening and integration suites passed; the counts are in the verification of the formula display entry of this release. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.

On top of main, the full suite ran 33,251 tests in 839 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,740 tests.
