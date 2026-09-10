---
"solve-engine": patch
---

The pipeline stages run direct when allocation tracking is off

`AllocationTracker.track` wraps a pipeline stage to measure its time and heap,
and it is off in production. Wrapping still cost two allocations on every
evaluation whether or not it was on: the closure passed to `track`, built at the
call site before `track` can decide anything, and the result object `track`
returns. The lexer, parser and VM stages now call through directly when tracking
is off, and wrap only when it is on.

Nothing a caller sees changes, and the tracked path is untouched: when tracking
is on, the stage is wrapped exactly as before and reports the same allocation
figures. This is a reduction in the garbage a single evaluation makes, not a
change to what it computes.

| workload                                  | before   | now      |
| ---                                       | ---      | ---      |
| 6,000 distinct expressions, evaluated 4x  | 136.3 ms | 133.6 ms |

About one per cent of wall time on the single-expression path, and never
slower; the larger effect is on the garbage collector over a long session,
which a short benchmark understates.

The boundary: this removes the wrapper allocations, not the stage work. It is
the companion to the profile's other allocation findings; the builder's
`build`/`reset` were looked at and left alone, since a pooled builder already
resets without reallocating and the bytecode it builds must own its buffers
because the program is cached (#464).

## Verification

The allocation-tracker and diagnostic-pipeline suites pass, so the tracked path
still measures each stage; the engine suite is green; and the differential fuzz
of documents, expressions and bytecode reports 0 disagreements, since the change
is which object the stage's result travels in, not the result. Closes #463.
