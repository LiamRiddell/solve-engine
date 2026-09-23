---
"solve-engine": minor
---

A table in a note can be looked up by its row's label, and a table of bands can be applied to an amount

The tables package could total, average or summarise a whole column, and that was all a markdown table was good for. A price list or a rate schedule written as a table could not be read one cell at a time, and a banded charge (an income tax, a commission scheme, a tiered tariff) had to be worked out by hand, band by band. Three forms now read the nearest table above the line:

- `column "cost" for "food"` reads one cell by its row's label, the first cell of the row. The match ignores case, and a row can be labelled with a number.
- `column "rate" for 45,000 in bands above` reads the cell of the band an amount falls in, taking the first column as where each band starts. `in bands` is what makes it a band match rather than an exact one.
- `45,000 through bands above` is the progressive total: each part of the amount is charged at the rate of the band it falls in, the rate being the last column.

With a table of `item | cost` rows (`rent 1200`, `food 300`), and a band table of `from | rate` rows (`0 0%`, `10,000 20%`, `40,000 40%`) above the line:

| expression | before | now |
| --- | --- | --- |
| `column "cost" for "food"` | error: unexpected token "cost" | 300 |
| `column "cost" for "food" * 12` | error: unexpected token "cost" | 3,600 |
| `column "cost" for "fuel"` | error: unexpected token "cost" | error: no row labelled "fuel"; its rows are "rent", "food" |
| `45,000 through bands above` | error: unexpected token "bands" | 8,000 |
| `$45,000 through bands above` | error: unexpected token "bands" | $8,000.00 |
| `column "rate" for 45,000 in bands above` | error: unexpected token "rate" | 40.00% |

The engine assumes no bands. The person writes them, so one form covers any country's income tax, any commission scheme and any tiered price, which is the same rule the tax forms follow: no rate is ever assumed. A rate can be a percentage (a share of the part in its band), a price such as `$0.18` (charged per unit, for a tariff on a count of units), or a plain number (a multiplier). A lookup answers with a number, an amount of money or a percentage, since those are what a price list and a rate schedule hold; money is read into an exact decimal and a total is summed in base ten, so `$10.10 through bands above` on a single 15% band is `$1.52`, where a double would round the half-cent down to `$1.51`.

Every doubt is refused by name, with the line to fix, rather than answered with a number that might be wrong: a label that is not in the table, two rows with the same label, a column named twice, an empty cell or a cell of text, band starts that do not rise down the table, a first column headed `up to` (which reads as where bands end, and would be one row out), a total whose first band does not start at 0, a plain `20` among percentages (a likely missing `%`), rates mixing percentages and prices, and an amount in a different currency from the bands. Typed on its own, with no document to read, each form answers with an error saying a document is needed, never a number and never a throw.

The boundary: a lookup matches the first column only, and answers with the one cell asked for; a cell of text is refused rather than handed on, since text in arithmetic reads as nothing. Units in cells (`12 kg`) are not read yet, and an amount with a unit is refused rather than compared with a table that does not state one. Rules beyond a table of starts and rates, such as an allowance that tapers with income or a flat fee per band, are not modelled; the payroll forms keep the full UK rules for England, Wales and Northern Ireland. The column aggregates (`sum of column`) are unchanged and still read plain numbers only, and only the nearest table above is read, as before. `column` becomes a lookup only when a quoted name follows it and `through` only in the phrase `through bands`, so a variable named `column` keeps working.

## Verification

A new suite pins every form through both document passes line for line: the exact lookup and its addresses, number and variable keys, money and percentage cells, exact money arithmetic, the band lookup at and between band starts, the progressive total with shares, prices and plain rates, currency adoption and mismatch, each refusal and its code, error propagation from a failing key or amount, an edited table re-answering, and the cell reader directly. The cross-path suite adds the three forms in its standard shape: the document result, the agreement between `parseDocument` and `evaluateDocument`, and the single-line refusal as a structured Error. New Table lookups and Banded rates pages carry proven `solve-doc` examples, including the refusals.

npm run verify:ci passes: TESTS tests across SUITES suites.
