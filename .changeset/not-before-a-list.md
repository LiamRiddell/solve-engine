---
"solve-engine": patch
---

`not` before a bracketed list is negation, so `not [true, false]` is `[false, true]` and `not [1, 2]` is refused by name rather than read as a variable called `not`

The word `not` is ordinary English, so the normaliser reads it as negation only where a value is expected and a token that can open a condition follows it. A square bracket was not one of those tokens, so in `not [1, 2]` the word stayed a name and the bracket became an index into a list of that name, and the line answered "Undefined variable: not", while `![1, 2]` and `not ([1, 2] > 1)` were read as negation. A square bracket now opens a condition, so the list reaches the negation itself: a list of answers is negated one answer at a time, as it is when a name holds it, and a list of numbers is refused in the words `not 5` and `![1, 2]` use.

| line | before | now |
| --- | --- | --- |
| `not [true, false]` | `Undefined variable: not` | `[false, true]` |
| `not [1 > 0, 2 > 3]` | `Undefined variable: not` | `[false, true]` |
| `not [1, 2]` | `Undefined variable: not` | refused: `"not" works on true or false, and [1, 2] is a list: compare it first, as in not (x > 3).` |
| `![1, 2]` | refused, as above with `"!"` | unchanged |
| `not 5` | refused: `"not" works on true or false, and 5 is a number: ...` | unchanged |
| `y = [true, false]`, `not y` | `[false, true]` | unchanged |

The boundary: a variable called `not` is still defined and read (`not = 3`, `not + 1`), but `not` before a square bracket is now always negation, so `not[0]` no longer reads an item of a list called `not`; it is refused by name. `not []` meets the refusal an empty list meets anywhere, and a list inside a list keeps its own.

## Verification

`FoundBug_notBeforeAList.spec.ts` holds 28 tests: lists of answers and of comparisons, a column, a nested `not`, `not` joined with `and`, the refusals of a list of numbers, a document through both passes with a name holding a list, and the variable called `not`; unit tests of `negates` before a square bracket and of `logicalNot` over a list (ordinary, boundary and hostile arguments: a word that only looks like `not`, a Cyrillic look-alike, a past-the-end position, a mixed list, a spelling that is not text); and the adversarial cases (prototype words with `Object.prototype` unchanged, a 300-answer list, deep brackets, a huge range and power, 500 lines, text edges, other-script digits, markup-shaped text, a zero-width space, a typo, a value from the line above, a check and an `if` over the negated list, every numeric edge, an empty and a nested list, CRLF). `AdversarialFeatureSweep.spec.ts` gains two forms.

The fast suite ran across 872 suites (35,433 of 35,438 tests passed, 5 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and `lint:dispatch-size` (`executeBytecode` at 47,376 bytes) passed, as did the proven docs examples, `NormaliserRulesRejectCheaply`, `CrossPathDocumentFeatures`, `AdversarialFeatureSweep`, every `FoundBug_*` spec and the error-code suites, with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. `npm run verify` as one command was not run.

On top of main, the full suite ran 37,299 tests in 887 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,839 tests.
