---
"solve-engine": patch
---

A line that reads another line's result depends on that position

The dependency graph indexed names: variables, globals, category tags and data
sources. The other half of what reads across lines has no name to index.
`prev`, `line 7`, `sum(line 3 : line 9)`, the `above` aggregates and a table
column all reach for a **position**, and registered nothing, so nothing asking
the graph what an edit or an arriving value affects could name them.

They are recorded now, and the visible half is the async path:

| document                        | a rate arrives, before | now       |
| ---                             | ---                    | ---       |
| `:rate = 100 USD in EUR`        | updates                | updates   |
| `prev * 2`                      | stays as it was        | updates   |

The edge is taken where the read happens rather than in each form. Every one of
those forms reads through the same closure, the per-line context's
`getLineResult`, so one hook covers all of them and a form added later is
covered without knowing about any of this.

A positional read is discovered while the line runs, exactly as a data-source
read is, so it is pinned the same way: the next registration of the line
recovers its edges from its text, where a position it reached for at run time
does not appear.

On positions moving, which is the question this was filed to decide: a
structural edit already clears the whole graph and the next pass rebuilds it,
and that is what every other edge kind relies on. Keying by position and
inheriting it is deliberate. A second invalidation policy for one kind would be
the thing that drifts.

The cost is the recording, and it is paid only by documents that read across
lines. Measured on a 2,000-line document, one edit, median of nine:

| document                        | before   | now      |
| ---                             | ---      | ---      |
| plain lines, no positional read | 1.979 ms | 2.007 ms |
| a running total every 20 lines  | 12.59 ms | 12.92 ms |
| every line a `prev` chain       | 2.279 ms | 2.448 ms |
| every line reading `line 1`     | 2.440 ms | 2.575 ms |

The second row is what made this worth measuring rather than assuming: an
`above` aggregate re-reads every line back to its boundary on every pass, so
recording naively cost 55% on that shape. Almost all of those calls describe an
edge that already exists, and recognising that without building the key, and
without a map lookup for a reader already being asked about, brought it back to
the noise.

## Verification

20 new tests: which positions each form registers, that the edge survives
re-registration, a line reading itself recording nothing, a repeat recording
one edge, a run of positions plus one far from it, removal and clearing, keys
not colliding with a variable or a tag of the same name, an aggregate's reads
being rebuilt after an edit, a structural edit clearing them and the next pass
putting them back, and the async path re-running a line that reads by position.
