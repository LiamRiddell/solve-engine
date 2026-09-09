---
"solve-engine": patch
---

An ordinary edit into a positional cycle reports the cycle

Two lines that read each other's positions have no settled value, because each
is computed from the other. Reached from scratch, neither has a value to start
from, so each reports the other and stays there. Reached by editing one line's
text, one of them already held a number, the other read it, and the pair chased
those numbers for as long as the document was open:

| document                          | action                      | before                      | now                   |
| ---                               | ---                         | ---                         | ---                   |
| `1 sprint = 2 weeks` / `prev + 5` | edit line 1 to `line 2 + 5` | a number, ten larger a pass | `Line 2 has an error` |

The insert and delete half was fixed in 2.38.19, keyed to the one moment the
document's shape provably changed. An ordinary edit moves no position, and every
rule tried for it that changed what a positional read returns, or when an answer
is thrown away, traded this for a disagreement of the same size somewhere else
(#444 records seven of them). Two things were wrong, and both were in the
dependency graph rather than in any read.

A positional edge outlived the text that read it. An edge is discovered while
the line runs and pinned, so a position the line stopped reading could not be
discovered at all: `prev + 1` edited to `7` still read line 1 as far as the
graph knew, and `total above` kept its edges to the lines above a heading that
had cut its block short. Anything consulting the graph was told what a line used
to read, so cycles that had been edited away were found, and a cycle re-closed
by removing the heading was nothing new. Now an edited line's positions go
before it runs, and a run cuts a line's positions back to the ones it read.

Nothing took a stale number off a cycle. A pass from scratch has every member
holding an error by the time the cycle closes, because some member reads a line
below it that has not run yet, and every positional form answers an unread or
errored line with an error, all the way round. A number on a member is the one
thing a settled pass never holds. Now, at the end of a pass in which a line
recorded a position it had not recorded before, the cycles through those lines
are found once, and each member holding a number is forgotten and marked to run
again. That leaves the members where a pass from scratch has them before they
first run, and from there both paths take the same steps to the same answers.
The walk is skipped while no edge points downwards (a cycle needs one, and a
document of `prev` and `above` has none), and it is one pass over the graph
however many lines gained an edge, so a column of `prev + 1` costs the same on
the pass after an insert as it did.

A goal seek now takes a positional edge to its target, the way `line N` does.
It reads the target through its own closures, and used to take none, so a
target edited to read the seek back (`line 3 + v1` under a `solve line 2 for
v1 = 27`) was a cycle nothing could see, and settled to a number where a pass
over the same text reports the cycle on both lines.

A goal seek's unknown is no longer recorded as a write. `solve line 4 for v1 =
27` varies `v1` inside the seek's own call frame and stores nothing, and `v1 =`
only has the shape of a definition. Claiming the write held the name open after
the `:v1 = 7` that gave it a value had been edited into the seek, so `v1 + 7`
went on answering `14` where a pass over the same text says `Undefined
variable: v1`. The 2.38.21 note drew the boundary at a seek that runs still
defining its variable; that boundary moves, because the seek never defined it.

The boundaries. A cycle through a name (`:a = line 2 + 1` above `a + 1`) is not
walked: the positional graph does not hold it, taking it apart would also mean
undefining the members' variables, and the fuzz generator emits only literal
definitions, so the shape is pinned in the spec rather than fixed. A block that
shrinks under a heading drops its edges on the aggregate's next run, so in the
one pass between the heading and that run the graph still over-reports; a walk
in that pass can reset a line whose inputs are settled, which recomputes the
same answer on its next run, one pass, never a strand. The cycle example on the
line-references page proves only its second line: the docs harness makes one
pass, and the first line's settled answer needs two.

## Verification

The differential fuzz of editing sessions (`npm run fuzz -- --generator=document`),
on the six seed ranges of 300 sessions the issue was measured against, reports 0
findings on every range; unmodified main reported 2 (seeds 24000051 and
27000208, both above). Six further ranges of 300 report 0, 3,600 sessions in
all. Reverting only the goal-seek write change brings back exactly seed
24000051, and reverting only the graph and evaluator changes brings back exactly
seed 27000208, so each part is necessary and neither masks the other.

The engine suite is green: 469 suites, 9,011 tests passing and 4 skipped under
`npx jest`, none of the skipped ones the #444 pair, which run again. One new
spec of 26 tests covers the edit shapes, the goal-seek cycle, the shrunk and
re-grown block, the from-scratch answers and pass counts of eight shapes (which
match main pass for pass), and the name-cycle boundary; the positional-edge spec
gains 9 tests for the graph's new behaviour and the goal-seek spec 1. A column
of 5,000 `prev + 1` lines with one forward reference in it evaluates within
noise of main on its first pass, a settled pass, and the pass after an insert.
`npm run lint:comments`, `npm run lint:docs` and `npm run typecheck` are clean.
