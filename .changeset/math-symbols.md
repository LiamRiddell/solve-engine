---
"solve-engine": minor
---

`≤`, `≥`, `√`, `∞` and `π` are read, as `×`, `÷`, `±` and `≠` already were

People paste and type the mathematical symbols: `≥` from a phone keyboard, `π` and `√` from a formula. The engine read the multiplication, division, plus-minus and not-equal signs, but each of these failed in its own way (#669).

| line | before | now |
| --- | --- | --- |
| `3 ≥ 2` | Unexpected token after expression: "2" | true |
| `3 ≤ 2` | Unexpected token after expression: "2" | false |
| `√16 + 9` | Undefined variable: √16 | 13 |
| `√(9 + 16)` | Undefined variable: √ | 5 |
| `π * 2` | Undefined variable: π | 6.28 |
| `1/∞` | Undefined variable: ∞ | 0 |

`≤` and `≥` are the `<=` and `>=` operators, and highlight as comparisons. `√` is a square root that binds as tightly as a minus sign, so `√16 + 9` is 13 and `2√3` is two times the root of three; it calls the builtin `sqrt` does, so a quantity and a negative number answer as `sqrt(...)` does. `∞` is infinity, and meets the refusals the functions already give it (`sin(∞)` has no real value).

`π` is pi only while nothing in the note is named `π`: `π = 3` then `π * 2` is still 6, on both document passes, as it was.

What is not added: the word `infinity`, which is ordinary English in a line of prose.

The operators page lists the new symbols beside the ones already read.

## Verification

`Issue669_mathSymbols.spec.ts` has 26 tests: `≤` and `≥` between numbers and between names with no spaces; `√` over a number, a bracket, a quantity, itself and a negative number, and on its own; `∞` and `π`, with the refusals the functions already give infinity and a variable named `π` kept on both passes; and adversarial cases: the word `infinity` as a name, a comparison with nothing on its right, and highlighting that matches the ASCII spellings.

The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
