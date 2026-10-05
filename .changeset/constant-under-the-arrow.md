---
"solve-engine": patch
---

`π` and `ans` under the arrow are read as their values, so `π km =>` is `3.14 km`, as `π km` is

The arrow (`=>`) keeps a name with no value as an unknown, which is what makes `foo + 1 =>` answer `foo+1`. It asked that question before trying the two readings a name with no value has anyway: `π` as the constant and `ans` as the line above. So under the arrow `π km` was refused as `Undefined variable: π` (and, before the fix for an unknown given a unit, answered `0.00 km`), `π + 1` stayed `π+1`, and `ans km` was refused. An equation counted `π` and `ans` as unknowns too, so `2x = π` was refused as having two, and `x*π = 2` was stored keyed by `π` (found while fixing an unknown under the arrow). Both are now read before the arrow's unknown, and an equation leaves them out of its unknowns; `pi`, `e`, `tau` and `phi` are constants the lexer reads and were never affected.

| line | before | now |
| --- | --- | --- |
| `π km =>` | Undefined variable: π | `3.14 km` |
| `π + 1 =>` | `π+1` | `4.14` |
| `pi + x =>` | `x+3.1415926536` | `x+3.1415926536` |
| `π + x =>` | `x+π` | `x+3.1415926536` |
| `2 + 3`, then `ans km =>` | Undefined variable: ans | `5.00 km` |
| `2x = π`, then `x =>` | This equation has 2 unknowns, x and π, ... | `1.5707963268` |
| `x*π = 2`, then `x =>` | `π stored as an equation: solve with "π =>"`, then `x` | `0.6366197724` |
| `π = 3`, then `π km =>` | `3.00 km` | `3.00 km` |

The boundary: a formula holds a constant as its decimal, as it holds any other number, so `π + x =>` is `x+3.1415926536` rather than keeping the letter; that is how `pi` was already read. A note that gives `π` or `ans` a value of its own is read with that value, as before. A look-alike (`Π`, `ϖ`, a Cyrillic `а` in `аns`) is an ordinary name. `ans` inside an equation is read when the equation is solved, relative to the line that asks, as `prev` is.

## Verification

`FoundBug_constantUnderTheArrow.spec.ts` holds 119 tests: `π` and `ans` under the arrow, twenty lines matched against the same line without the arrow, `π` in a formula, an equation over `π` or `ans` solved for its real unknown, and a note that names either; unit tests of `readsWithoutValue` (ordinary, near spellings, empty and padded names, prototype words, look-alikes); and the adversarial cases (prototype words with `Object.prototype` unchanged, look-alikes refused under their own spelling, a long sum of `π` answered and one past the length limit refused, deep brackets, text edges, markup, a check and a what-if, an edit, `ans` with nothing above it, a typo, every numeric edge through both document passes, empty and whitespace lines, CRLF, zero and negative zero). `CrossPathDocumentFeatures.spec.ts` gains `ans` under the arrow through `parseDocument`, `evaluateDocument` and the single-expression refusal; `AdversarialFeatureSweep.spec.ts` gains `π X km =>`, `X * π + foo =>`, `2x = π + X`, `ans` under the arrow over the numeric edges and `x*π = X`.

The fast suite (`npm run test:ci`), `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the docs, hardening and integration suites passed; the counts are in the verification of the formula display entry of this release. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.

On top of main, the full suite ran 33,251 tests in 839 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,740 tests.
