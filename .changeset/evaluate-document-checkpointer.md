---
"solve-engine": patch
---

Borrowing an engine for one whole-document pass no longer redirects the host's later async results

`evaluateDocument` stands up its own document model and evaluator on an engine the caller may already
be driving, and its own comment promises that borrowing the engine "leaves nothing behind". It put the
document model back and left one thing behind.

Constructing a `ThreeTierEvaluator` wires both the document model and its own VM checkpointer onto the
engine's async batcher, unconditionally. Only the model was restored. The checkpointer is not a
cosmetic field: it is what the batcher uses to restore VM variable state when an async value arrives
later, against checkpoints keyed by line position. So after one borrowed pass, a host's own async
results were restored from checkpoints recorded for a document that no longer existed, at positions
belonging to entirely different lines.

The pass now takes the previous checkpointer before it constructs the evaluator that seizes it, and
puts it back in the same `finally` that restores the document model, so a failed pass restores it too.

The boundary: this restores what the borrowed pass displaced. Other state the pass legitimately leaves
on a shared engine, such as cached bytecode for expressions both documents happen to contain, is
unaffected and is not residue.

## Verification

A new suite asserting that a host engine driving its own document has both its document model and its
checkpointer restored after a borrowed pass, and after three of them in a row. The checkpointer
assertions fail before this change. `npm run verify` passes: 480 suites, 9,124 tests.
