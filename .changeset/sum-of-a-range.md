---
"solve-engine": patch
---

`sum` and `prod` with a single list add or multiply its elements, so `sum(1:3)` is 6 and `prod([2, 3, 4])` is 24, and the pages say where a colon is a range

The ratios page said a colon inside an aggregate is a range, and the map-reduce page that it is one inside any brackets or function call, but `sum(1:3)` threw `Expected ","`. The colon inside `sum(` was already a range rather than a clock time; `sum` and `prod` had only their two-argument form, `sum(expression, list)`, so the range's start was read as the expression and the parser stopped at its colon. With a single argument they now fold the list's own elements, as `sum(x, list)` does.

| line | before | now |
| --- | --- | --- |
| `sum(1:3)` | `Expected ","` | `6` |
| `prod(1:5)` | `Expected ","` | `120` |
| `sum([10, 20, 30])` | `Expected ","` | `60` |
| `:xs = [1, 2, 3]` then `sum(xs)` | `Expected ","` | `6` |
| `sum(5)` | `Expected ","` | refused: a Matrix or Range collection is required |
| `sum(x^2, 1:3)` | `14` | `14` |
| `sum(10, 20, 30)` | `60` | `60` |

The boundary: a colon is a range only as the list of `map`, `reduce`, `sum` and `prod`. Everywhere else it stays a clock time, which is the far more common reading and what `max(9:30, 10:15)` means, so `(0:3)` and `max(1:3)` are unchanged; the map-reduce page no longer promises a range inside any brackets or call, and the ratios page names the four. `average(1:3)` still asks for line references, the lines package's reading of that call. A range that counts down, has a fractional bound or runs past the collection limit is refused by name, as it was in the two-argument form.

## Verification

`FoundBug_sumOfARange.spec.ts` holds 26 tests: the one-argument forms over ranges, lists, money, units and a nested call; the two-argument and spreadsheet forms unchanged; a list held in a variable through both document passes; the refusals; the clock times that must stay clock times; unit tests of `callHasOwnComma` (a comma of the call's own, one inside a list or a nested call, one after the call, an empty call, a line that ends inside it, unbalanced brackets, prototype words, and a 100,000-token call read in linear time); and the adversarial cases (a huge range, deep brackets and a long list inside the call, prototype words as the list with `Object.prototype` unchanged, text edges, a typo, an unclosed call, a range bounded by the line above with a check and a what-if through both passes, and every numeric edge as a bound and an element). `AdversarialFeatureSweep.spec.ts` gains three forms.

The fast suite ran across 767 suites (25,907 of 25,912 tests passed, 4 skipped); its one failure was `LlmsTxt.spec.ts`, since the pages changed, and it passes after `docs/public/llms-full.txt` was regenerated. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar` and the proven docs examples passed, and `executeBytecode` measured 44,322 bytes by hand, unchanged (`lint:dispatch-size` cannot find its spec inside a worktree). `npm run verify` as one command was not run.
