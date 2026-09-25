---
"solve-engine": patch
---

Twice-yearly compounding is read, and `compounded monthly` means `compounding monthly`

`compounding semi-annually` was refused, and the refusal named `semi-annually` among the intervals it accepts: the hyphen split the word before the interval was looked up, so the lookup saw `semi` (#801). `compounded monthly`, the commoner English, was left as a token the line could not place.

| line | before | now |
| --- | --- | --- |
| `interest on 1000 over 3 years at 5% compounding semi-annually` | refused: compounding semi: expected one of annually, yearly, semi-annually, ... | 159.69 |
| `... compounding semiannually` | refused | 159.69 |
| `... compounding half-yearly` | refused | 159.69 |
| `... compounded monthly` | Unexpected token after expression: "compounded" | 161.47, the same as `compounding monthly` |

`compounded` is read only in that position, after a rate, so it stays free as a variable name. Every interval the refusal lists is one the engine reads, and a spec checks it.

What stays refused: `biannually`, which some readers take to mean every two years, and `twice yearly`, a two-word form the tail does not read.

The interest page lists the intervals read and shows semi-annual compounding and `compounded`, proven.

## Verification

`Issue801_semiAnnualCompounding.spec.ts` has 11 tests: the four spellings, the result sitting between annual and quarterly, the growth form, `compounded` after a rate and as an ordinary name elsewhere; and adversarial cases: a half-written interval, a hyphenated word that is not one, and a check that every interval the refusal lists is one the engine reads.

The engine suite is 14,209 tests in 588 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,331 bytes on Node 24, 14,109 under the ceiling) and the bundled-consumer contract.
