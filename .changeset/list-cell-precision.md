---
"solve-engine": patch
---

The figures of a list are shown to the same precision: `map(x px at 300 dpi, 1:2)` is `[0.00333 in, 0.00667 in]`, where it was `[0.00333 in, 0.01 in]`

Each cell of a list was formatted on its own. A cell that rounds to zero at two places takes three significant digits (`tooSmallToPrintText`), so a third of a hundredth of an inch was `0.00333 in`; its neighbour, 0.00667, does not round to zero, so it was cut to two places and read `0.01 in`, as if it were measured less finely (found in testing). Once a list shows one cell to three significant digits, every other cell below one whose places would hide its digits now takes the same form (`listTakesSignificantForm` in `format/FormatEngine.ts`, `hiddenDigitsText` in `utilities/Number.ts`), in the one-line form and in the aligned grid.

| line | before | now |
| --- | --- | --- |
| `map(x px at 300 dpi, 1:2)` | `[0.00333 in, 0.01 in]` | `[0.00333 in, 0.00667 in]` |
| `map(x px at 300 dpi, 1:4)` | `[0.00333 in, 0.01 in, 0.01 in, 0.01 in]` | `[0.00333 in, 0.00667 in, 0.01 in, 0.0133 in]` |
| `[0.001, 0.123]` | `[0.001, 0.12]` | `[0.001, 0.123]` |
| `[0.001, 0.5]` | `[0.001, 0.50]` | `[0.001, 0.50]` |
| `[0.5, 0.25]` | `[0.50, 0.25]` | `[0.50, 0.25]` |
| `2 px at 300 dpi` | `0.01 in` | `0.01 in` |

The boundary: a cell the places already show in full keeps them (`0.5` stays `0.50`), a cell of one or more keeps the place budget, and a list with no cell that rounds away is written as before, so a single figure on its own line keeps the scalar rule. A list of money keeps its currency's places for every cell that does not round away (`[$0.001, $0.006]` is `[$0.001, $0.01]`), since a cent is the precision of an amount and money has its own rule for a fraction of one.

## Verification

`FoundBug_listCellPrecision.spec.ts` holds 25 tests: the line that exposed it through `evaluateExpression`, `evaluateLine`, `parseDocument` and `evaluateDocument`, longer, plain and negative lists, cells shown in full, lists with no small cell, the scalar rule, the aligned grid; unit tests of `listTakesSignificantForm` (ordinary; boundary: no small cell, a cell left out of the preview, zero, money, a wider place budget; hostile: an empty list, counts past and below the shape, infinities and NaN, a boolean cell, a prototype word as the unit), `hiddenDigitsText`, `significantDigitsText` and `tooSmallToPrintText`; and the adversarial cases (prototype words as a cell or a unit with `Object.prototype` unchanged, twenty thousand small cells within the budget, every text edge, a list from the line above, a name, a conversion, a check and a section, money, a converted list, zero, negative zero, the smallest doubles, every numeric edge, CRLF and a trailing newline). `AdversarialFeatureSweep.spec.ts` gains `map(x * (X) px at 300 dpi, 1:2)`. Gates run: `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:changeset`, `lint:error-codes`, `lint:docs`, the docs example specs, the format specs, the hardening and integration specs, and the fast suite.

On top of main, the full suite ran 36,308 tests in 879 suites, all passing but 5 skipped, and `npm run test:temporal` passed its 3,803 tests.
