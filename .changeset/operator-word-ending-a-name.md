---
"solve-engine": patch
---

A name of several words ending in an operator word is refused by name, so `monthly take = 4000` says that `take` is a spelling of minus

A word the engine already reads is never part of a name of several words, so that a name cannot hide an operator (#743), and a line that would make one part of a name is refused by name. That refusal covered an operator word first (`take home = 5`) and not one last: `monthly take = 4000` failed with `The line ends after "take", where a value was expected`, which reads as a slip in a sum (found while collecting the other-apps parity corpus). The refusal now covers an operator word after the plain words too. Allowing it instead was weighed and not done: `monthly take 500` subtracts 500 from `monthly`, and the same word could not be minus on one line and part of a name on the next. An operator with nothing after it is no arithmetic, so no equation is offered.

| line | before | now |
| --- | --- | --- |
| `monthly take = 4000` | The line ends after "take", where a value was expected | "monthly take" cannot be a name: "take" is a spelling of minus. Choose other words, or join them as monthly_take. |
| `monthly_take = 4000` | `4,000` | `4,000` |
| `take home = 5` | refused naming `take` | refused naming `take`, unchanged |

The boundary: an operator word between plain words (`my take home = 5`) is read as an equation's, as it always was, and with two unknowns it is now refused as an equation with several unknowns. The variables page gives the refusal and the two ways to write the name.

## Verification

`FoundBug_operatorWordEndingAName.spec.ts` holds 67 tests: the reported line through every entry point, each operator word last and its meaning, the code, the joined name that works and the first-word refusal unchanged; unit tests of `multiWordNameRefusal` (an operator word last, alone, between names, a symbol, more than four words, no `=` or an `=` first, a word that is not plain); and the adversarial cases (prototype words with `Object.prototype` unchanged, five thousand words before `take`, a ten-thousand-letter word, text edges inside the name, markup, a later line reading the refused words, `take` as subtraction, a check and a what-if around it, every numeric edge, an empty right side, CRLF and padding). `AdversarialFeatureSweep.spec.ts` gains `monthly take = X`.

The fast suite ran 29,604 tests in 806 suites with this batch's four fixes (29,599 passed, 5 skipped, none failed), and `npm run typecheck`, `typecheck:tests` (no new errors), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples, the docs, hardening and integration suites (11,522 tests in 101 suites), the two lexer fuzz suites (331 tests) and the dispatch-loop size check (45,759 bytecode bytes, read with the script's own command run by hand) passed. `npm run verify` as one command, the bundled-consumer contract and the benchmarks were not run.
