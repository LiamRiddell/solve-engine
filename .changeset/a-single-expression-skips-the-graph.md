---
"solve-engine": patch
---

A single expression no longer touches the dependency graph

`evaluateExpression` routes through `evaluateLine(-1, ...)`, where line -1 is
the sentinel for "no document position". The dependency graph connects lines
across a document, so an edge from a line that has no position and no siblings
connects nothing any reader consults, yet every single-expression evaluation
paid to scan its tags and register that edge. A profile of the pipeline put it
at about a tenth of the single-expression path, spent on a graph nothing reads.

Line -1 now skips the registration.

| workload                                  | before   | now      |
| ---                                       | ---      | ---      |
| 6,000 distinct expressions, evaluated 4x  | 146.4 ms | 132.5 ms |

Measured by running the old and new builds alternately in one process, and
stable across runs: about 10% off the single-expression path, never slower.

The boundary. This is the single-expression path only. A document evaluates in
positive line numbers through the incremental evaluator, which reads the graph
to decide what an edit affects, so its registration is untouched. The graph's
other readers all work in positive line numbers too: `evaluateLine(n, ...)`,
`evaluateIncremental`, and the language service's cross-line completions, which
a broad version of this change was measured to break before it was narrowed to
line -1 exactly. Two things a single expression does still rely on are kept:
variables accumulate across calls through the VM, not the graph, and the async
data-source dependency that a pending value's arrival reads is registered
separately and stays.

## Verification

3 new tests in `ASingleExpressionSkipsTheGraph` pin that variables still
accumulate across `evaluateExpression` calls (including across a read-only line
and a line that writes nothing), that an error is still a value and a failed
definition leaves the name as the lines above left it, and that the graph is
left empty for line -1 so the cost cannot creep back. The engine suite is green
(the language-service, `evaluateIncremental` and cache-coherence suites, which
exercise the graph without a document in positive line numbers, all pass), and
the differential fuzz of documents, expressions and bytecode reports 0
disagreements.
