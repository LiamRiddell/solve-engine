---
"solve-engine": patch
---

Highlighting a line no longer runs it: colouring `total += 5` leaves the total where it was

The language service decides whether to colour a line by asking the engine whether it parses, through `tryCompileExpression`. Most lines do their work in the bytecode that check produces and never runs. A few do it while being compiled instead: a running total adds to its total, a bare assignment sets its variable, an equation is stored for a later `=>`, and a unit definition registers its unit. The check did that work too, so each highlight of `total += 5` added another 5, and an editor that highlights on every keystroke moved the total further with each one.

| document, then highlighted | read back | before | now |
| --- | --- | --- | --- |
| `total += 5`, its line highlighted once | `total` | 10 | 5 |
| `total += 5`, its line highlighted four times | `total` | 25 | 5 |
| `total += 5`, then `total += prev` highlighted | `total` | error: Cross-line references require a real document | 5 |
| empty, then `z = 2 + 2` highlighted | `z` | 4 | error: Undefined variable: z |
| empty, then `w^2 - 4 = 0` highlighted | `w =>` | [-2, 2] | w |
| `1 sprint = 3 weeks`, `3 sprints in weeks`, line 1 highlighted and then deleted | line 2 | 9 weeks | error: Undefined variable: sprints |

The last row is the quiet one. Checking a unit definition registered the unit again as belonging to no line, so deleting its real line no longer removed it, and the conversion below went on answering from a definition the document no longer contained.

`tryCompileExpression` now matches those shapes and compiles their operands, the same parse it always made, and runs and stores nothing. No variable, running total, function, equation, user unit, random draw, cached line result or dependency edge changes when a line is highlighted, completed or checked. What it still writes are the compile caches, memos keyed by the line's text that change no answer. A colon assignment (`:x = 3`), a function definition (`f(x) = x * 2`) and a `random seed 7` line were never affected: their work is in their bytecode, which the check has never run.

Because nothing runs, the check now answers the question it was always asked, whether the line is well formed, the same way for every line. A running total whose step would fail when run still parses, as the expression it adds always has:

| line | highlighted, before | highlighted, now |
| --- | --- | --- |
| `5 + nope` | `5` number, `+` operator, `nope` variable | unchanged |
| `total += nope` | nothing | `total` variable, `+=` operator, `nope` variable |

A running total's name is also painted as the variable it is. The lexer, which sees one word at a time, reads a lone `b` as the unit bit and a lone `s` as seconds, but the engine reads `b += 5` as adding to a variable called `b`.

| line | before | now |
| --- | --- | --- |
| `b += 5` | `b` unit | `b` variable |
| `s -= 2 kg` | `s` unit | `s` variable, `kg` unit |

The boundary: only the check is read-only. `compileExpression` still applies a line's effect, because the incremental evaluator compiles through it and depends on the effect happening. `explainLine`, which a host puts behind a hover, evaluates the line to build its derivation and is not covered here. The name fix covers a running total's name only; a unit-letter name on the left of a bare assignment (`b = 5`) or in a function's parameters (`g(t) = t + 1`) is still painted with the lexer's category. Highlighting costs the same as before: over a 200-line document, both builds in one process, interleaved, a full pass from an empty cache took a median of 0.51 to 0.55 ms before and 0.47 to 0.54 ms now, across three runs of eleven.

Fixes #559.

## Verification

A new suite highlights, completes and checks every kind of line that changes something when it runs (running totals, colon and bare assignments, function definitions, unit definitions, random seeds, equations, `=>` and `expand`), several times over, after a batch pass and under a live editor, and requires every variable, running total, function, equation, user unit, cached line result and dependency edge to be unchanged afterwards. It also pins the unit definition that outlived its line, the check's agreement with `compileExpression` on every shape it now checks rather than runs, and the running total's name. The editor integration page says highlighting is read-only. `npm run verify:ci` passes: TESTS tests across SUITES suites, with the bundled-consumer contract.
