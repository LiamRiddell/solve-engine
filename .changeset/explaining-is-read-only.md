---
"solve-engine": patch
---

Explaining a line no longer changes the document: hovering over `total += 5` leaves the total where it was

`explainLine` builds a derivation from the values a line arrives at, so it has to run the line, and it ran it against the document's own state. A host puts a derivation behind a hover, which is called as often as the pointer moves, and each call applied the line again: a running total grew, an assignment set its variable, a unit definition replaced the unit and sent the whole document back for re-evaluation, and a global changed in every open document.

| document, then explained | read back | before | now |
| --- | --- | --- | --- |
| `total += 5`, then `total += 5` three times | the three answers, then `total` | 10, 15, 20, then 20 | 10, 10, 10, then 5 |
| `:x = 3`, then `:x = 30` | `x` | 30 | 3 |
| `1 + 1`, then `z = 2 + 2` | `z` | 4 | error: Undefined variable: z |
| a live editor with `1 sprint = 2 weeks`, `6 sprints in weeks`, then `1 sprint = 3 weeks` | `6 sprints in weeks` | 18 weeks, and both lines marked for re-evaluation | 12 weeks, and neither line marked |
| a document with `global :g = 1` and another with `global :g * 10` (showing 10), then `global :g = 5` in the first | the second, after its next pass | 50 | 10 |

The run now happens in scratch state that is discarded afterwards. The VM it runs on reads the document's variables, functions and equations and keeps its own writes; the process-wide store for `global` names holds the run's writes aside and tells no document about them; a cross-line read (a goal seek re-running its target, say) records its edge in a dependency graph of the run's own, and the line reads through a context of its own, so the document's graph and the pass's shared context are untouched; and a unit definition answers `sprint defined` without registering the unit. The running-total names and the random-draw bookkeeping are put back as they were. What the run still writes are the compile caches, memos keyed by the line's text that change no answer.

Every explanation of a line now answers as its first one did before this change. Across 29 lines, ordinary derivations, dates, units and the state-changing shapes above, the first explanation is identical before and after.

The boundary: the answer is still the one the line gives against the document as it stands, the same one `evaluateExpression` returns for it, not its answer at its own place in the document. With the total at 5, explaining `total += 5` answers 10, as it always has on the first hover. The scratch state costs a few microseconds per explanation (over eight lines, both builds in one process and interleaved, a median of 26 microseconds before and 29 now), which a hover does not notice.

Fixes #566.

## Verification

A new suite explains every kind of line that changes something when it runs, plus a global assignment, a goal seek and two ordinary derivations, three times each, after a batch pass and under a live editor, and requires every variable, running total, function (body included), equation, user unit, cached line result, dependency edge, global and document line (answer and dirty flag) to be unchanged, and every explanation to match the first. It pins the answers themselves, their agreement with `evaluateExpression` on an engine of its own, a global that notifies no document, a unit definition that leaves the live document clean, and a goal seek that leaves no edge. The scratch VM and the global store's scratch runs have specs of their own. The explaining a line page says explaining changes nothing. `npm run verify:ci` passes: 10,950 tests across 523 suites, with the bundled-consumer contract.
