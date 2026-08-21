---
"solve-engine": patch
---

Cross-line features in a batch parse no longer build a document model per pass.

The support for line references and table columns in `parseDocument` and
`evaluateLines` was added by pointing the pass at a freshly built `DocumentModel`.
That allocated a line record and index for every line of every document, even
one that used no cross-line feature at all, adding a few milliseconds to a large
parse and needless heap churn. The batch cross-line source now reads earlier
lines straight from the scan and the results array the pass already holds, which
are references rather than new allocations, so a document that uses no such
feature pays nothing. Line references and table aggregates resolve exactly as
before.
