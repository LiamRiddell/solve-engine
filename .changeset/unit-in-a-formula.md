---
"solve-engine": patch
---

Arithmetic between an unknown and an amount in a unit is refused by name, rather than answered with the unit dropped

A formula is algebra on numbers: its tree records how the unknowns combine and has nowhere to keep a unit. Arithmetic between an unknown and a quantity read the quantity as its bare number, so `foo * 5 km =>` answered `5foo`, `5 km / foo =>` answered `5/foo` and `solve(2x = 4 km, x)` answered `2`, each with the kilometres gone and nothing to say so (found while fixing an unknown under the arrow). The symbolic page said nothing about carrying a unit into a formula, so the honest minimum is a refusal: the line now says a formula keeps no units, names the unknown and the unit it would lose, and points at giving the unknown a value or leaving the unit off, with a new code, `SYMBOLIC_QUANTITY_OPERAND`. The same refusal covers `+`, `-`, `*`, `/`, a power, a function call and either side of `solve`.

| line | before | now |
| --- | --- | --- |
| `foo * 5 km =>` | `5foo` | A formula keeps no units, so combining "foo" with an amount in km would drop the km. Give "foo" a value on a line above, or write the formula without the unit. |
| `foo - $5 =>` | `foo-5` | A formula keeps no units, so combining "foo" with an amount in USD would drop the USD. ... |
| `(5 km)^foo =>` | `5^foo` | A formula keeps no units, so combining "foo" with an amount in km would drop the km. ... |
| `solve(2x = 4 km, x)` | `2` | A formula keeps no units, so combining "x" with an amount in km would drop the km. ... |
| `y = x * 2`, then `y * 5 km` | `2x*5` | A formula keeps no units, so combining "x" with an amount in km would drop the km. ... |
| `foo = 3`, then `foo * 5 km =>` | `15.00 km` | `15.00 km` |
| `foo * 5 =>` | `5foo` | `5foo` |

The boundary: carrying units through a formula, so that `foo * 5 km =>` answered `5foo km`, is a feature of its own and is not attempted; a refusal is the smallest change that stops the wrong answer. A plain number and a percentage are not units and combine as before. A unit written straight after an unknown (`foo km =>`) is the earlier refusal, `Undefined variable: foo`, and is unchanged.

## Verification

`FoundBug_unitInAFormula.spec.ts` holds 93 tests: each operator, a power, a call and `solve` refused naming the unknown and the unit, money and other units, the code, plain numbers and percentages unchanged, the unit kept once the unknown has a value, and a stored formula meeting a unit; unit tests of `symbolicQuantityRefused` (ordinary, no quantity, a quantity with no unit, zero, negative zero and the largest and smallest doubles in a unit, a formula with no unknown left, prototype words) and of `symbolicPow`, `symbolicBuiltin` and `solveEquationValues` with a quantity; and the adversarial cases (prototype words with `Object.prototype` unchanged, a long sum of unknowns, deep brackets and a depth past the complexity guard, a look-alike unit, text edges, markup, a quantity from the line above, a check and a what-if, an edit, a typo, every numeric edge, CRLF). `AdversarialFeatureSweep.spec.ts` gains `foo + X km =>`, `hypot(foo, X km) =>`, `solve(2x = X km, x)`, a stored formula times a quantity, and the prototype-word form.

The fast suite (`npm run test:ci`), `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the docs, hardening and integration suites passed; the counts are in the verification of the formula display entry of this release. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
