---
"solve-engine": patch
---

An ISO 8601 duration with no digit before its decimal mark, such as `P.5D`, is refused by name, saying the digit is needed

ISO 8601 durations are read and a malformed one is refused as `ISO_DURATION_MALFORMED` (#760), but `P.5D` was a parse error instead ("found .5"). The lexer splits it into `P` and `.5`, and the duration rule joined a decimal back on only after a digit, which `P` is not. A point and digits touching the text before them, with a designator letter touching the digits, are now joined, so `P.5D`, `PT.5S` and `P1DT.5H` reach the duration grammar, which refuses each by name and says a digit is needed before the decimal mark, as the standard requires.

| line | before | now |
| --- | --- | --- |
| `P.5D` | Expected an operator or the end of the line, but found ".5" | P.5D is not an ISO 8601 duration: a decimal mark needs a digit before it, as in P0.5D. |
| `PT.5S` | the parse error | PT.5S is not an ISO 8601 duration: a decimal mark needs a digit before it, as in PT0.5S. |
| `P1DT.5H` | the parse error | refused, pointing at `P1DT0.5H` |
| `P0.5D` | `0.50 days` | `0.50 days` |
| `P * .5` (with `P = 4`) | `2` | `2` |

The boundary: nothing is joined across a space, so `P * .5` and `P .5D` are what they were, and a point with no designator letter after its digits (`P.5`, `P1D.5x`) is left alone. A comma written as the decimal mark with no digit before it (`P,5D`) is still a parse error, because a comma after a name usually separates two items, as in `max(P,5)`. The time page shows the refusal beside the other malformed spellings.

## Verification

`FoundBug_isoDurationBareFraction.spec.ts` holds 15 tests: the refusal in a date part, a time part and after a whole part, the duration it points at, a variable named `P` times a half; unit tests of `readIsoDuration` (the point and the comma with no digit before them, a mark with no digit after it, a mark at the end, the valid form, a long fraction, prototype-shaped text) and of `isoDurationNormalizerRule` (the joined refusal token, no join across a space or without a designator, lower-case and prototype words after the fraction); and the adversarial cases (prototype words after the fraction and as a variable with `Object.prototype` unchanged, a ten-thousand-digit fraction within budget, digits from other scripts, text edges, a variable named `P` beside the refusal through a what-if in both document passes, every numeric edge beside it, and the refusal in each part). `AdversarialFeatureSweep.spec.ts` gains `P.5D + X`, `P * .5 + X` and the prototype-word form `P.5X`.

The fast suite ran across 800 suites (28,880 of 28,884 tests passed, 4 skipped, none failed), and `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the hardening and integration suites and the dispatch-loop size check (44,791 bytecode bytes) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
