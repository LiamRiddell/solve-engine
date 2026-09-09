---
"solve-engine": patch
---

A cycle through a name, a running total or a function reports the cycle

Two lines that depend on each other have no answer of their own, because each
value they could hold is computed from that same value a pass earlier. The
positional half of this was fixed already: `line 2 + 5` above `prev + 5` reports
the cycle however the text was reached. Three more ways to close one were
found once the document fuzzer could write a definition that reads a position,
a running total that reads a position, and a user function.

| document                                                | before                         | now                                          |
| ---                                                     | ---                            | ---                                          |
| `:v1 = v2 + 5` / `:v2 = v1 + 8`, the pin above edited away | each read the other, climbing | `Undefined variable: v2`, `Undefined variable: v1` |
| `:v0 = v2 + 8` / `:v2 = 18` / `:v2 = v0 + 8`            | climbing by sixteen a pass     | `Undefined variable: v2`, `18`, `Undefined variable: v0` |
| `spent += line 2` above `spent += 9`                    | `144`, climbing                | `Line 2 has not been evaluated yet` on both  |
| `f(x) = x + 4` / `f(9)`, definition edited away         | `13` for the rest of the session | `Undefined function: f`                    |

The second row settled the rule. It is a cycle from the moment it is written,
and it only starts moving once `:v2 = 18` lends it a number, so nothing keyed to
an edit could catch it. The rule is the spreadsheet's, and it is what a single
fresh pass through `parseDocument` already says: **a line that sits on a cycle
runs the way a fresh pass runs it**, with every name it reads holding what the
lines above left and every line below it counted as not yet evaluated. No
member ever computes a number for another to read, so the cycle is reported in
the same words on both paths and stays reported. Which lines sit on a cycle is
recomputed only when the dependency graph changes, following positions and
names alike, so a document with no cycle pays nothing per pass.

Underneath it, one more invariant a fresh pass keeps and the incremental path
did not: when a line runs, each name it writes holds what the lines above left.
`:v3 = 44` above `:v3 = v3 + 3` is 47 on every fresh pass because line 1 puts 44
back first; edit line 1 away and nothing did, so line 2 read its own 47 and
climbed by three a pass. A definition is put back to the prefix before it runs
and again if it fails. The prefix comes from the checkpoint chain, which now
drops the entry of a line that stopped writing and replaces the entry of one
that threw. A function is a definition too: the engine can unbind one now, and
does so when its defining line is edited away or deleted.

Two boundaries. A pinned cycle that used to converge on the incremental path
(`:v3 = v2 + 7` / `:v2 = line 1 + 8` / `:v2 = 31` settled at 38, 46, 31) reports
the cycle now, as the batch pass always did. And a plain forward reference is
untouched: `line 2 + 1` above `7` is still `8`, and `x + 1` above `:x = 5` is
still `6`, since neither line depends on itself.

## Verification

14 new tests in `ACycleThroughANameReportsIt`, 5 more in
`ALineThatErroredDefinedNothing`, and the cycle specs now take their expected
wording from the fresh pass. The document fuzzer's generator gained a
definition that reads a position or another name, a definition that fails, a
total that reads a position, and a user function; over the same 3,000 random
editing sessions its reports went from 110, before any of this, to 0.
