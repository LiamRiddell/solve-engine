---
"solve-engine": patch
---

An unknown given a unit or a percentage under the arrow is refused as the undefined name it is, so `foo percent =>` is no longer `0.00%`

The arrow (`=>`) evaluates with every name that has no value kept as a formula, which is what makes `foo + 1 =>` answer `foo+1`. A formula has no single number, and the operations that need one amount read it as 0: giving a value a unit or a currency, writing it as a percentage, in a base, as a fraction or in scientific notation, `as number`, and a tolerance. So `foo percent =>` answered `0.00%` and `foo km =>` `0.00 km`, while `foo percent` alone says `Undefined variable: foo` (found while collecting the other-apps parity corpus). Each of those operations now refuses a formula with the error an ordinary line gives, naming its first unknown, and unary plus keeps the formula as the no-op it is. The same reading reached a formula stored by a bare assignment without any arrow, and is refused the same way.

| line | before | now |
| --- | --- | --- |
| `foo percent =>` | `0.00%` | Undefined variable: foo |
| `foo km =>` | `0.00 km` | Undefined variable: foo |
| `$foo =>` | `$0.00` | Undefined variable: foo |
| `foo as hex =>` | `0x0` | Undefined variable: foo |
| `foo +/- 1 =>` | `0 ± 1.0` | Undefined variable: foo |
| `+foo =>` | `0` | `foo` |
| `y = x + 1`, then `y km` | `0.00 km` | Undefined variable: x |
| `foo + 1 =>` | `foo+1` | `foo+1` |
| `foo = 12`, then `foo percent =>` | `12.00%` | `12.00%` |

The boundary: arithmetic between an unknown and a quantity is still algebra on the numbers alone, so `foo * 5 km =>` is `5foo` with the unit dropped, as before; carrying units through a formula is a feature of its own. `foo + 10% =>` is still `foo+0.1`, the percentage read as its fraction, where `200 + 10%` adds a tenth of 200. Under the arrow `π` and `ans` are kept as unknowns before their constant readings are tried, so `π km =>` is refused naming `π`. The other-apps parity spec's pinned case (`foo percent =>`) moves from `test.failing` into the passing set.

## Verification

`FoundBug_unknownUnderTheArrow.spec.ts` holds 139 tests: each form that read the unknown as 0, the refusal matched against the line without the arrow and its code, the forms that must stay formulas, unary plus, a name with a value, and the refusals that already named the unknown; unit tests of `unknownNameIn` (ordinary, a value that is not a formula, a formula with no unknown, prototype words, a nine-thousand-deep formula); and the adversarial cases (prototype words with `Object.prototype` unchanged, a long sum of unknowns, text edges, a look-alike Cyrillic letter, markup, a stored formula with and without its value through both document passes, a typo, a check and a what-if, a snapshot round trip, an edit, every numeric edge, an empty arrow, CRLF). `CrossPathDocumentFeatures.spec.ts` gains the refusal through `evaluateLine`, `parseDocument`, `evaluateDocument` and a live edit; `AdversarialFeatureSweep.spec.ts` gains `X percent =>`, `(X + foo) km =>`, `foo * X km =>`, `$(foo + X) =>`, a stored formula given a unit, and the prototype-word forms.

The fast suite ran 29,604 tests in 806 suites with this batch's four fixes (29,599 passed, 5 skipped, none failed), and `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the docs, hardening and integration suites (11,522 tests in 101 suites), the two lexer fuzz suites (331 tests) and the dispatch-loop size check (45,759 bytecode bytes, read with the script's own command run by hand) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.

On top of main, the full suite ran 31,617 tests in 823 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,666 tests.
