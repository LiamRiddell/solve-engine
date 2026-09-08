---
"solve-engine": patch
---

A name whose defining line is gone reads as undefined

The VM's variable store only ever accumulated. Nothing removed a binding when
the line that created it was deleted or edited into something else, so the value
outlived the document:

| document            | action            | before | now                     |
| ---                 | ---               | ---    | ---                     |
| `:x = 12` / `x + 4` | delete line 1     | `16`   | `Undefined variable: x` |
| `:x = 12` / `x + 4` | line 1 to `5 + 5` | `16`   | `Undefined variable: x` |

Both survived any number of further passes: nothing ever removed the name.

The dependency graph already knew. It drops a line from the producers of a key
it no longer writes, so a key with no producers left is a name no line defines.
It reports those now, and the engine acts on them: the value leaves the VM, and
the checkpoint chain is told as well, since it records what each line wrote and
would otherwise put the name back on the next restore.

The decision is made once, at the end of a pass, and made against the document
rather than the graph. Both halves of that are load-bearing. A line holding
several inline expressions registers once per expression, so the one that
defines a name is followed by one that does not; and the engine registers a line
before the pass records that line's results, so its recorded write set is a pass
behind. Either would answer wrongly mid-pass. And the graph itself cannot be
asked afterwards, because a structural edit clears it and a viewport leaves the
lines outside it unregistered, while a line's recorded write set survives both.

The consequence is that the name is forgotten at the end of the pass that
removed its definition, so the lines that read it show their new answer on the
pass after that. An editor makes one anyway, and every way of making it sooner
answers the question before it can be answered.

The boundary: without a document there is no such authority.
`evaluateExpression` reuses line numbers across independent calls, so
re-registering line 1 replaces its edges every time, and variables accumulating
across calls is that path's whole contract. It is unaffected.

A user unit is not covered. `1 sprint = 2 weeks` lives in its own table rather
than the VM, and removing its line still leaves the unit defined; that needs the
table to know which line defined what, and is filed separately.

## Verification

7 new tests: deleting the definition, editing it into something else, a name
another line still defines being kept, re-adding it bringing the name back, a
line holding several expressions keeping what it defines, the single-expression
path keeping its variables across calls, and a restore not putting a removed
name back. Found by a differential fuzz against a settled pass.
