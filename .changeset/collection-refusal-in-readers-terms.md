---
"solve-engine": patch
---

`sum`, `prod`, `map` and `reduce` over a single value are refused in the words of the call typed, where each opened "map/reduce requires a Matrix or Range collection"

The refusal is raised while the line runs, by the step that reads a collection, and that step did not know which call it served: `sum` and `prod` compile to the same instruction as `reduce`. That instruction's last operand was a flag for whether a starting value was given, and `sum` and `prod` always give one, so it now also says which of the three was written (the old flag's values keep their meaning). The refusal names the word typed, what it does with a list, the two things it takes and what it was given, and a `sum` of one value points at the form that adds values one by one. The code, `MAP_REDUCE_REQUIRES_COLLECTION`, is unchanged.

| line | before | now |
| --- | --- | --- |
| `sum(5)` | map/reduce requires a Matrix or Range collection | sum adds up the items of a list or a range, such as [1, 2, 3] or 1:3, and this is a single number; to add values one by one, list them, as in sum(5, 6). |
| `prod(5)` | the same | prod multiplies together the items of a list or a range, such as [1, 2, 3] or 1:3, and this is a single number. |
| `map(x * 2, 5)` | the same | map works through the items of a list or a range, such as [1, 2, 3] or 1:3, and this is a single number. |
| `reduce(acc + x, "abc")` | the same | reduce folds into one the items of a list or a range, such as [1, 2, 3] or 1:3, and this is text. |
| `sum(1:3)` | `6` | `6` |

The boundary: the wording changes, the answers do not. A list, a range or a name holding one folds as before, and a value that has not arrived, or that failed upstream, passes through unreworded. `average(1:3)` and `mean(1:3)` still read the colon as line references and a clock time: those calls belong to the lines package and the spreadsheet aggregates, whose single-argument and bracketed-list readings are their own, and they are left for a change of their own. The map-reduce page shows the refusals.

## Verification

`FoundBug_collectionRefusalInReadersTerms.spec.ts` holds 25 tests: each call over a number, text, a quantity, a boolean and a percentage, the code unchanged, every form over a list still folding, a fault passed through, unit tests of `ReduceForm` and `reduceFormCall` (each form, values no parselet emits), `describeNonCollection` (each kind, a kind with no word of its own), `notACollection` and `collectionToValues` (each call, the default, a pending or failed collection, prototype words as the call with `Object.prototype` unchanged), and the adversarial cases (prototype words as the collection, a long sum within and past the complexity limit, deep brackets, a huge range, text edges and markup, a value from the line above that a what-if turns into a list through both document passes, a typo, an unclosed call, and every numeric edge in each call). `FoundBug_sumOfARange.spec.ts` asserted the old words for `sum(5)` and `sum("abc")`, and now asserts the new ones. `AdversarialFeatureSweep.spec.ts` gains `map(x * 2, X)` and `reduce(acc + x, X)`.

The fast suite ran across 776 suites (26,551 of 26,555 tests passed, 4 skipped, none failed), with `docs/public/llms-full.txt` regenerated for the changed pages. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed, and `executeBytecode` measured 44,186 bytes by hand (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.

On top of main, the full suite ran 29,773 tests in 801 suites, all passing but 4 skipped once two package pages and one spec linked main's createQueryResolver section by its heading (in this change), and `npm run test:temporal` passed its 3,509 tests.
