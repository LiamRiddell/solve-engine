---
"solve-engine": patch
---

Every row of a markdown table is markup on both document paths, not only its separator row

The line classifier sees one line at a time, and a line starting with a pipe is a table row only because of the separator row in its block, so the classifier recognised the `|---|` row alone. Every other row went to the expression path and reported an error, on both `parseDocument` and `evaluateDocument`, and a line under a table was blamed on its last row (#616). The docs, and four comments in the engine, already said the rows were skipped.

| note | before | now |
| --- | --- | --- |
| a four-line table, then `total of column "cost" above` | each header and data row: No prefix parselet found for token: BIT_OR ("\|"), three entries in `errors` | no result and no error on any row; the total is 700 as before |
| `10`, a three-line table, then `total above` | Line 4 has an error | No lines above to aggregate: the table ends the block, as a heading does |

The rule, the same on both paths: a pipe row is table markup when its block of pipe rows holds a separator row with a header above it. The batch pass decides it after the scan, walking each block once. The incremental pass decides it when a row is classified, walking the block once and keeping the answer until the document changes, and an edit that can change the answer (a separator added or removed, a pipe row becoming or ceasing to be one, a line inserted or deleted beside one) sends the block back to be classified, so typing a table in a live editor reads the header as markup once the separator is under it. A cell edit inside a table leaves the other rows as they were.

What stays: a pipe row with no separator in its block is an expression, since `|` is bitwise or (`5 | 3` is 7), and a raw row alone through `evaluateLine` is still a parse error, as the cross-path suite pins. A row holding an inline solve is read like prose holding one, so the solve is still worked out.

The table-columns page says what makes the rows a table.

## Verification

A new spec unit-tests every table-block helper and the scan's classification, runs the survey's notes through both passes, and covers inline solves in cells, indented tables, two tables, a CRLF table at the end of a note, pipe rows with no separator, prototype-named cells a 2,000-row table under a time bound, and a count of the line reads a live pass over a 20,000-row table makes, which a row-by-row walk to the separator would have made quadratic (it took the existing 130,000-row column spec to seven minutes before the walk was made once per block). The cross-path suite gains six cases, among them live edits that add and remove a separator and a deletion that joins two pipe blocks, and the adversarial sweep gains three table documents. The full suite is 13,788 tests in 564 suites, all passing (four skipped), and `npm run verify:ci` passes, including `smoke:globals`, the three-zone `test:temporal` run and the bundled-consumer contract.
