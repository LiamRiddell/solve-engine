---
"solve-engine": patch
---

The word `percent` after a constant reads as the `%` sign does: `pi percent` is `3.14%`

`percent` and `percentage` after an amount mean the `%` sign, so `5 percent` is `5.00%`. The rule that reads them that way took the word only after a number, a closing bracket or a name, and `pi`, `e`, `tau`, `phi`, `golden ratio`, `∞` and `prev` each lex as a token of their own, so `pi percent` was the parse error "Expected an operator or the end of the line, but found "percent"" while `pi%` answered and `π percent`, which lexes as a name, did too (found while testing percentages). The rule now reads the word after each of them. A constant with a unit (`gravity`, `speed of light`) is read the same way, so its word meets the refusal its `%` meets, that an acceleration is not a proportion, rather than a parse error.

| line | before | now |
| --- | --- | --- |
| `pi percent` | Expected an operator or the end of the line, but found "percent" | `3.14%` |
| `e percent of 200` | the same parse error | `5.44` |
| `200 + pi percent` | the same parse error | `206.28` |
| `tau percent` | the same parse error | `6.28%` |
| `7`, then `prev percent` | the same parse error | `7.00%` |
| `gravity percent` | the same parse error | An acceleration is not a proportion, so it has no percentage: ... |
| `pi%` | `3.14%` | `3.14%` |
| `pi as percent` | `314.16%` | `314.16%` |

The boundary: the word binds exactly as the sign does, so `2 pi percent` is two times pi percent (`0.06`), as `2 pi%` is, and `(2 pi) percent` is `6.28%`. After `as`, `in` or `to` the word is still the converter that writes a number as a percentage. `∞ percent` is refused, as `∞%` is, because a hundredth of an infinity is too large to write as a percentage.

## Verification

`FoundBug_constantPercentWord.spec.ts` holds 114 tests: sixteen lines against the same line with the sign, a number before the constant, the converter after `as`, `in` and `to`, `prev` and `ans` through both document passes and refused on their own, a constant with a unit and an infinity before the word; unit tests of `percentWordNormalizerRule` and `RATE_BEFORE` (each constant's token, the number, bracket and name it always took, the conversion keywords and another word it must not take, nothing after the constant, prototype words as a type or a word); and the adversarial cases (prototype words with `Object.prototype` unchanged, look-alikes of pi refused under their own spelling, a sum of three hundred in time, text edges, markup, a typo, a constant percentage from the line above under a check and a what-if, a note that names `π`, every numeric edge times a constant percentage and above `prev percent` through both passes, `prev` at the top, after a blank line and with CRLF, zero and negative zero). `AdversarialFeatureSweep.spec.ts` gains `pi percent of X` and `X + e percent`. Gates: see the verification of `unit-named-unknown.md`.

On top of main, the full suite ran 35,461 tests in 864 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,777 tests.
