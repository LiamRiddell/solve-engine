---
"solve-engine": minor
---

Line references and table aggregates now resolve when a document is parsed in one pass, not only while it is edited.

A cross-line expression, `total above`, `line 3`, `sum(line 1 : line 4)`, `prev`, and the table-column aggregates, reads the lines before it through a document model. Only the incremental path an editor drives set that model up, so those expressions worked live but answered a no-document error through `parseDocument` and `evaluateLines`, the batch calls a library reaches for. The same document read differently depending on which method was used.

The batch pass now wires a document model for its own duration, fills each line's result in as it computes it so a backward reference reads a real value, and restores whatever model was there before, so an engine that an editor already drives is left untouched:

```
10
20
30
total above     was LINE_REF_NO_DOCUMENT, now 60
```

A document that uses no cross-line feature is unchanged in result, and pays only the cost of building the line index for the pass. A single-expression `evaluateExpression` still has no document, so a bare `total above` with nothing above it is still refused rather than reading a stale document.
