---
"solve-engine": patch
---

An edit costs the viewport, not the distance from line 1

A pass runs from line 1 to the end of the viewport, so scrolling down made every
keystroke more expensive in proportion to how far down you had scrolled, while
the number of lines actually evaluated never changed. Measured on the built
package, a thirty-line viewport and one edit inside it:

| lines  | at the bottom, before | now      | at the top |
| ---    | ---                   | ---      | ---        |
| 500    | 0.086 ms              | 0.056 ms | 0.045 ms   |
| 1,000  | 0.158 ms              | 0.091 ms | 0.061 ms   |
| 3,000  | 0.480 ms              | 0.173 ms | 0.072 ms   |
| 10,000 | 1.415 ms              | 0.389 ms | 0.083 ms   |
| 20,000 | 3.004 ms              | 0.847 ms | 0.083 ms   |

Thirty executions in every row. The right-hand column is the same edit made near
the top of the same document, where the distance is nil, and it is flat before
and after: it is the walk between line 1 and the viewport that was being paid
for.

Two changes, neither of which alters what is evaluated or in what order:

A clean line outside the viewport now returns before its text is scanned for
emptiness and its expressions extracted. Neither can change what happens to a
line that is neither compiled nor executed, and that line was arriving at the
end of the dispatch having paid for both.

And the span is walked once, in order, rather than descended into per position.
The order tree answers a contiguous range in one pass; asking it for each
position separately was a third of the cost of an edit on a long document. Two
shapes of that were measured and the slower one discarded: resolving the ids
inside the document model is 20% faster than handing them back and asking for
each line individually.

The boundary: a pass still visits every position up to the viewport, so the cost
is still linear in that distance, with a much smaller constant. Not visiting
them at all would change what `EvalResult.lines` contains, which is a published
shape, so it is not done here.

## Verification

6 new tests covering what must not have changed: the tier counts for a viewport
at the bottom of a document, that the returned lines still cover every position
from 1, that a dirty line below the fold is still compiled, that a definition
above the viewport still reaches a line inside it, that a narrow viewport and a
whole-document pass agree line for line, and that the span reads in document
order after lines are inserted. `npm run verify:ci`, the bundled-consumer
contract, and the playground build all pass.
