---
"solve-engine": patch
---

A line re-run when a value arrives reads the state its own position has

When a data source resolves, the batcher re-executes a few lines out of the
middle of a document against the engine's VM. That VM holds what the last full
pass left in it, which is the state at the END of the document, and that is the
right answer only for a name written once. A name written twice has a value per
position:

| line             | before | now   |
| ---              | ---    | ---   |
| `:x = <fetched>` | `7`    | `7`   |
| `x + 100`        | `107`  | `107` |
| `:x = 99`        | not re-run | not re-run |
| `x + 200`        | `207`  | `299` |

The arriving value leaked past the redefinition, because the line that redefines
`x` was not itself affected and so was not re-run.

`VMCheckpointer` exists to reconstruct that state and was built nowhere: the
document path constructed its evaluator without one, so `restoreTo` was a no-op
on every shipped path. It is built there now, and the batch runs as a sweep
through the document: the VM is restored once to the state just before the
earliest affected line, then each writing line passed on the way has its
recorded bindings applied, so a line running at position N sees the prefix
position N actually has. Restoring once and sweeping costs the chain once rather
than once per line.

A line that writes updates its own checkpoint in place rather than taking a new
one, because taking one drops the chain after it and the sweep is about to walk
through exactly those entries.

## The chain is flat now, and that is where the cost went

Building it into the document path made a pass over a document of two thousand
definitions nearly four times slower. Each checkpoint's bindings were created
with the previous checkpoint's as their prototype, so the chain was as deep as
the document has definitions, and creating and reading two thousand of those is
what V8 charges for a prototype chain that long.

Nothing needed the inheritance. `restoreTo` already walked the parent links and
applied each checkpoint's own keys, which is the same set either way; only one
query method read the prototype, and it walks the parent links too now. The
bindings are flat, null-prototyped objects, so a variable named `constructor` is
still a key like any other.

| a pass over 2,000 lines        | before   | with the chain | flat     |
| ---                            | ---      | ---            | ---      |
| no definitions                 | 5.04 ms  | 5.04 ms        | 4.88 ms  |
| every line a definition        | 6.04 ms  | 23.12 ms       | 6.73 ms  |
| a definition every 20 lines    | 4.77 ms  | 4.81 ms        | 4.89 ms  |
| 200 definitions and readers    | 4.56 ms  | 4.93 ms        | 4.78 ms  |

## The boundary

This makes a re-run of a subset correct. It does not make the evaluator's full
pass cheaper, which is a different question and was answered separately. A host
driving the batcher itself supplies no chain and gets exactly the previous
behaviour, rather than a half-applied sweep.

## Verification

`AsyncPipelineIntegration.spec.ts` §6 is no longer skipped. It was skipped for
this fault and its expectation was written against a `LOAD_VAR` that answered
zero for an undefined name, so it asserted 10 where 15 is correct; both are
fixed. 12 further tests: the twice-defined document through the batcher with and
without a chain, the chain carrying an arrived value into the next batch, a
checkpoint holding only its own line's bindings, a lookup across twenty
definitions, shadowing, a variable named after an inherited property, and
updating or applying one checkpoint without disturbing the rest.
