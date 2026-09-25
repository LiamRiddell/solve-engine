---
"solve-engine": patch
---

A table column's summaries read its money cells, as `total above` reads the same figures on lines

`total of column "cost" above` and the other column summaries read plain numbers only. A money cell was dropped without a word, a column of money was refused outright, a comma in the wrong place was read as thousands grouping, and a percentage vanished (#651). The lookup beside them already read those cells; the summaries now read them the same way.

| table | form | before | now |
| --- | --- | --- | --- |
| `$500`, `$200` | `total of column "cost" above` | error: no plain-number cells to aggregate | $700.00 |
| `500`, `$200`, `1,200` | `total of column "cost" above` | 1,700 | $1,900.00 |
| `500`, `$200`, `1,200` | `count of column "cost" above` | 2 | 3 |
| `12,57`, `1` | `total of column "cost" above` | 1,258 | 1 |
| `20%`, `1` | `total of column "cost" above` | 1 | refused: the cell on line 3 is a percentage |

A money column totals in the currency written first, and a plain number joins it as an amount in that currency, which is what `total above` gives for `500`, `$200` and `1,200` typed as lines. Two currencies are refused by name, as `total above` refuses `$500` over `£200`. The minimum, maximum, median, spread, mode and standard deviation are in the currency too; the variance of a money column is refused, since it would be in square dollars. `12,57` is not grouped in threes, so it is text and skipped, as a lookup already treated it. A percentage is counted by `count` and refused by the summaries that add or compare, rather than dropped.

What this does not cover: a cell with a unit (`5 km`) is still not read, and the refusal for a column of them now says so. A column of plain numbers, decimals included, totals exactly as before.

The table-columns page shows a money column and says which cells are read.

## Verification

`Issue651_tableColumnsReadMoney.spec.ts` pins every summary over a money column in 16 tests, with adversarial cases: a 20,000-row money column, a symbol with no amount, misgrouped money (`$1,2`), a negative amount, an ISO code beside a symbol, the variance refused by name, a percentage cell under `count` and `max`, a column of units and a column of text. `CrossPathDocumentFeatures.spec.ts` runs a money column, two currencies, a percentage and misplaced grouping through `parseDocument` and `evaluateDocument` and asserts they agree; the single-expression refusal of each column form was already pinned in the same file. Two existing tests that pinned the old reading now pin the new one: a money cell beside a plain number in `ColumnAggregate.spec.ts` totals $1,250.00 rather than 1,200, and the column aggregates beside a lookup in `TableLookups.spec.ts` give $1,250.00 and $625.00.

The engine suite is 14,062 tests in 582 suites, all passing (four skipped), and `npm run verify:ci` passes on the branch rebased onto main after #808, including the docs proofs, the three-zone `test:temporal` run, `lint:dispatch-size` (47,481 bytes on Node 24, 13,959 under the ceiling) and the bundled-consumer contract.
