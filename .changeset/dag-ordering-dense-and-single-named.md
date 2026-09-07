---
"solve-engine": patch
---

DAG: ordering a change is roughly twice as fast, and never names a line twice

`getAffectedLinesInOrder` is what the incremental engine re-runs after an edit,
and in what order, so its cost is paid on every keystroke that moves a value.
The topological sort has been rebuilt around dense integer nodes: lines and the
keys between them are numbered into one range, the graph is held as a compressed
sparse row rather than a map of arrays, and the edges are discovered once as
integers rather than looked up by name in each of four passes.

Measured on one machine, medians of eleven interleaved rounds of the committed
graph against this one, in the same process:

| shape                                | before  | now     | change |
| ---                                  | ---     | ---     | ---    |
| order a 2,000-line chain             | 1.54 ms | 0.60 ms | -61%   |
| order a 5,000-line mixed document    | 0.32 ms | 0.12 ms | -62%   |
| order 2,000 members and 2,000 totals | 1.28 ms | 0.58 ms | -55%   |
| order a fan of 10,000 readers        | 3.60 ms | 1.92 ms | -47%   |
| register a 5,000-line document       | 1.20 ms | 1.10 ms | -8%    |
| remove 5,000 mixed lines             | 1.65 ms | 1.54 ms | -7%    |
| walk 2,000 members and 2,000 totals  | 0.21 ms | 0.20 ms | -8%    |

The registration and removal paths got the smaller half of it: one hash per edge
instead of three, one read set per line rather than two identical ones, and no
lookup at all into the two indexes a plain line cannot appear in.

## A line was named twice

The same work found a fault in the sort, and it is the reason this is worth
reading rather than only worth merging.

When no node has a free edge, which is what a cycle looks like, the sort seeds
itself with the lowest affected line rather than stopping. That line's own edges
were then walked a second time when its last dependency drained, so it was
emitted twice, and the second walk released lines that were not ready, which
reordered the tail as well. Two lines that refer to each other are enough:

| document                                | before         | now         |
| ---                                     | ---            | ---         |
| `:a = b + 1` / `:b = a + 1` / `a + b`   | `[1, 2, 3, 1]` | `[1, 2, 3]` |

A line named twice is re-evaluated twice, and for an accumulator that is a
different answer rather than a slower one.

A differential fuzz of 8,000 random graphs, comparing the two implementations
across 418,000 answers, found 1,566 results where the old sort repeated a line
and none where the two disagreed about anything else. Audited against the
contract directly over 19,640 orderings: 764 repeated lines before, none now,
with the same ordering quality on the cyclic graphs where no valid order exists.

## The boundary

This is the sort's constant factor and one fault in its fallback, not a change
of algorithm: ordering was already linear in lines plus keys after 2.38.6, and
still is. What is left in it is string hashing, roughly sixteen thousand map and
set operations for a two-thousand-line chain, which only interning keys to
integers at registration would remove. That is a change to every index in the
file for a path that now costs 0.6 ms on a document that size, so it is not
made here.

## Verification

9,209 tests in 458 suites, 12 of them new: every affected line named exactly
once on cyclic, self-referential and tag-keyed shapes, and every producer before
every consumer on chains that run against document order, on a group with many
members and many aggregates, and on a fan. Four benchmarks added for the shapes
that had none, including the mixed document a notepad actually makes.
`npm run verify:ci`, the bundled-consumer contract, and the playground build all
pass.
