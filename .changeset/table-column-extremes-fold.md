---
"solve-engine": patch
---

`min of column` on a long column answers instead of overflowing the stack

The three table reductions that take an extreme were written as
`Math.min(...cells)`, which makes the whole column into an argument list. Past
roughly 126,000 arguments V8 overflows, so a table well inside the engine's own
document-line cap came back as *Maximum call stack size exceeded*, and through
`evaluateLine` it escaped as a thrown error rather than arriving as a value.

| expression, 130,000-row column | before | now |
| --- | --- | --- |
| `min of column "n" above` | `Maximum call stack size exceeded` | `1` |
| `max of column "n" above` | `Maximum call stack size exceeded` | `130,000` |
| `spread of column "n" above` | `Maximum call stack size exceeded` | `129,999` |
| `sum of column "n" above` | `8,450,065,000` | `8,450,065,000` |

`sum` on the byte-identical table always answered, because it folds, and that is
what isolated the cause to the three that spread.

They fold now, in a single pass for `spread`, which needs both ends. The fold is
seeded with the identities `Math.min()` and `Math.max()` return for no arguments,
so an empty column reads exactly as it did, and folding keeps the NaN
propagation and the `-0` preference the spread form had.

The regression test asserts the raw spread form still throws at the size the
document uses, so a future V8 that raises the argument limit reports itself
rather than letting the test pass vacuously.

Found by an adversarial sweep for crashes reachable from a document, alongside
#384, #385, #387, #388 and #389.
