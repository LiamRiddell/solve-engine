---
"solve-engine": patch
---

A line reference follows the position after an insert or a delete

`line 5` names wherever line five happens to be, so inserting a line above it
changes what it refers to without changing a character of the line doing the
referring. The same is true of `prev`, which names a different neighbour, and of
the `above` aggregates, which cover a different block. None of that reached the
invalidation a structural edit performs, which followed the names a deleted line
wrote and nothing else, so a positional reader kept the answer it had computed
about a position that now holds something else.

| document            | action           | before | now                             |
| ---                 | ---              | ---    | ---                             |
| `10` / `line 1 + 5` | insert `20` at 1 | `15`   | `25`                            |
| `line 2 + 4` / `10` | insert `5` at 1  | `14`   | `Line 2 has not been evaluated` |

Every positional reader is re-run, not only the ones whose target moved. The
second row is why: `line 2 + 4` at position 1 is an ordinary reference, and the
insert leaves the same text at position 2, referring to itself. That is not
visible from the target alone, and positional readers are a small minority of a
document's lines, so re-running all of them costs almost nothing and cannot be
wrong.

A line also refuses to read its own position now, rather than being handed its
own previous result. From scratch that never came up: a line's result is not
there yet when it runs, so reading its own position gave nothing and the line
reported it. Only a structural edit could produce a self-reference that already
had a perfectly good value, from when it meant something else.

Refusing it closed a disagreement between the entry points as well. A
self-reference used to report `Line 1 has an error` through `evaluateDocument`,
which is what a line says when the line it read holds an error, and `Line 1 has
not been evaluated yet` through `parseDocument`, which is what the case actually
is. Both give the second sentence now.

The boundary: this is about a position's meaning changing, not about evaluation
order. A plain forward reference still resolves the way it always has on the
incremental path, which reaches its answer by running the document again rather
than in one sweep.

## Verification

8 new tests: a reference following an insert and a delete, a reader shifted onto
itself, a self-reference written as one, the two entry points agreeing on it,
`total above` and `prev` following their block after an insert, and a document
with no positional reader left untouched.

Found by the differential fuzz of editing sessions, which now covers line
references and positional aggregates: it reported this in the first sixty cases
it ran.
