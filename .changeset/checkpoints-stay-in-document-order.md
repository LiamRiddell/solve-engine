---
"solve-engine": patch
---

VM checkpoints stay in document order

`VMCheckpointer.restoreTo` reads its checkpoint list as a walk through the
document: it takes the last entry at or before a line, stopping at the first
entry past it, and replays that entry's parent chain from the root. Both halves
assume the list ascends, and a re-run appended instead of replacing, so it did
not.

A document whose lines 1, 2 and 3 each define something, with line 2 edited and
run again, left the list as `[1, 2, 3, 2]`:

| after editing line 2      | before                      | now         |
| ---                       | ---                         | ---         |
| `restoreTo(2)` gives      | the value from before the edit | the edited one |
| line 2's parent chain     | line 3, which comes after it | line 1      |

So a host restoring to a line read the value from before its own edit, and the
chain it walked defined a variable from a line that had not run yet.

A line snapshotted again now drops every checkpoint at or after it first, which
keeps the list ordered and gives the new entry the line before it as its parent.
Nothing is lost by dropping them: a pass runs in document order, and a line
running from cache now takes a checkpoint too, so the entries removed are
re-taken by the same pass as it continues.

That second half was its own hole. Only a line the pass compiled recorded what
it wrote, so a clean line sitting between two dirty ones left a gap in the
chain, and the truncation above would have dropped entries nothing put back.

The boundary: this is a fix to a published constructor argument, not a new
behaviour. `evaluateDocument` still builds its evaluator without a checkpointer,
so nothing inside the engine restores VM state yet. Making the incremental path
depend on it is a separate piece of work, and it is what the async and
positional-edge issues are both waiting on.

## Verification

10 new tests: the list staying ordered, restoring after a re-run, not defining a
variable from a later line, the parent chain, a forward pass being untouched,
re-running the first line, and four through the evaluator covering one
checkpoint per defining line, a clean line still checkpointing, the chain
holding the edited value, and repeated passes not growing it. Five of the ten
fail without the fix.
