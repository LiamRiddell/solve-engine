---
"solve-engine": patch
---

A percentage written as a value inside a list is refused by name, so `[100, 200] + [10%, 20%]` no longer answers `[100.10, 200.20]`

A list cell holds a plain number, and a list literal stored a percentage as its fraction, so `[10%, 20%]` showed as `[0.10, 0.20]` and every list form read 0.1 and 0.2: adding the list to prices added 0.1 and 0.2, where `100 + 10%` is 110, and `sum([10%, 20%])` was 0.30 rather than 30%. A list that knew its cells were percentages would have to carry that through every list form (a sum, an average, a product, a conversion, a matrix product), and the engine already refuses to write a list as a percentage (`[0.1, 0.2] as %`), so a percentage as a cell of a plain list is now refused (`LIST_PERCENTAGE_UNSUPPORTED`), naming the percentage and its fraction and pointing at the two forms that say what was meant. The refusal sits where every list is built from its cells, so a literal, `map` and `vec2` agree.

| line | before | now |
| --- | --- | --- |
| `[100, 200] + [10%, 20%]` | `[100.10, 200.20]` | refused: `A list holds plain numbers, so it cannot hold 10% as a percentage. ...` |
| `[10%, 20%]` | `[0.10, 0.20]` | refused, as above |
| `sum([10%, 20%])` | `0.30` | refused, as above |
| `[10%, 20%] * 2` | `[0.20, 0.40]` | refused, as above |
| `[1, 7%]` | `[1, 0.07]` | refused, naming 7% and 0.07 |
| `map(x%, [10, 20])` | `[0.10, 0.20]` | refused, as for `[10%, 20%]` |
| `[50%] in m` | `[0.50 m]` | refused, naming 50% and 0.5 |
| `[100, 200] + 10%` | `[110, 220]` | `[110, 220]` |
| `[0.1, 0.2]` | `[0.10, 0.20]` | `[0.10, 0.20]` |

The boundary: a percentage outside a list is unchanged (`[100, 200] + 10%`, `10% of [100, 200]`, `[1, 2] > 10%`), and so is a fraction written as a number. A percentage in a list with a unit keeps its own refusal, `MATRIX_CELL_NO_UNIT`. `mean([10%, 20%])` and the other aggregates now meet the refusal before they run; `average` takes line references, not a bracketed list, and is unchanged.

## Verification

`FoundBug_listOfPercentages.spec.ts` holds 35 tests: every form that built such a list (a literal, a row and a grid, `percent` spelt out, `map`, `vec2`, a conversion, a cell read, `sum`, `mean`, `max`, `reduce`, multiplying), the unit-list refusal kept, the forms the message points at, both document passes agreeing; unit tests of `percentageCellRefused`, `percentText` (7%, 12.5%, zero and negative zero, a negative, 2^53, the extreme doubles) and `listFromCells` (the new refusal, the unit refusal kept, a fault first, the cells it held before); and the adversarial cases (prototype words with `Object.prototype` unchanged, a long list, a long sum, deep brackets, a huge range and power, text edges and other-script digits, a typo, a value from the line above, a comparison, a check and a sparkline over such a list, an edit through both passes, every numeric edge, CRLF). `AdversarialFeatureSweep.spec.ts` gains two forms.

The fast suite ran across 870 suites (35,170 of 35,175 tests passed, 5 skipped, none failed). `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` passed, as did the proven docs examples and the hardening, integration and error-code suites, with `guide/error-codes.md` and `docs/public/llms-full.txt` regenerated. `npm run verify` as one command was not run.

On top of main, the full suite ran 37,299 tests in 887 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,839 tests.
