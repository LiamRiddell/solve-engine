---
"solve-engine": patch
---

Fix markdown table-column aggregates through `parseDocument` / `evaluateLines`.

`sum of column "cost" above` (and the average/min/max/count/median siblings) resolved correctly while a document was edited but returned a `TABLE_NO_DOCUMENT` error when the same document was evaluated in one pass through the batch library APIs. The per-line context wired the raw-line reader only for the incremental path; it now also reads from the batch scan, so a table aggregate resolves the same way through both, as the other cross-line reads already do.
