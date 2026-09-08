---
"solve-engine": patch
---

A goal seek that could not run stops holding its variable open

The write set recorded on a line comes from its compiled form, which says what
the line *would* assign. Goal seek is where that parts company with what
happened: `solve line 5 for v1 = 22` compiles as a line that writes `v1`, and
when there is no line 5 it assigns nothing and reports so.

That recorded write is what the end-of-pass settle asks when deciding whether a
name is still defined by anyone. A line claiming a write it never made held the
name open, so the value from a definition that had been edited away stayed in
the engine:

| document                                                       | before                   | now                      |
| ---                                                            | ---                      | ---                      |
| `v1 * v2` / `solve line 5 for v1 = 22` / `prev + 3` / `69 + 2` | `Undefined variable: v2` | `Undefined variable: v1` |

Both are errors, which is what let it survive: the line was wrong about *which*
name was missing, because `v1` still held `44` from a definition no line made any
more. A pass over the same text has never seen that value and says `v1`.

A pending value still counts as a definition. It has not failed, it has not
arrived, and forgetting the name while it loads would leave every reader of it
undefined in the meantime.

Found by the differential fuzz of editing sessions, once its generator was
taught the cross-line forms: goal seek, line ranges (`sum(line 1 : line 3)`) and
markdown table columns. Those are the forms that carry the most state between
passes, so they are the ones most worth driving through an editing session, and
this was the first thing they found.

## Verification

5 new tests: the failing goal seek no longer holding its variable, the write set
it records being empty, a goal seek that *does* run still defining its variable,
an ordinary definition untouched, and a definition that still stands not being
forgotten because a later line failed.
