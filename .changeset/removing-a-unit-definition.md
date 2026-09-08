---
"solve-engine": patch
---

A unit whose defining line is gone stops converting

`1 sprint = 2 weeks` registers a unit on the engine, and nothing removed it when
the line that said so was deleted or edited into something else. The conversions
below it went on working from a definition the document no longer contained:

| document                                    | action              | before    | now         |
| ---                                         | ---                 | ---       | ---         |
| `1 sprint = 3 weeks` / `3 sprints in weeks` | delete line 1       | `9 weeks` | `Undefined` |
| the same                                    | line 1 to `:v = 47` | `9 weeks` | `Undefined` |

A definition belongs to the line that made it now. A line drops its own
definitions on the way through being compiled again, so a line that has stopped
being a definition stops defining, and one that still says the same thing puts it
straight back. A deleted line never compiles again, so its definitions are
dropped as it goes.

Losing a unit has to reach the lines that used it, because a unit is expanded
while a line is compiled and those lines hold bytecode built around it. That
invalidation is driven by comparing the units in scope before and after a pass
rather than by counting removals, and the difference matters: a line that
redefines the same unit on every pass removes and re-adds it every time, so
invalidating on the removal alone would recompile the document for ever.

## Verification

6 new tests: editing the definition away, deleting it, a definition that has not
changed surviving five passes, re-adding it bringing the unit back, one
definition going while another stands, and the batch pass being unaffected.

Found by a differential fuzz that drives random documents through random editor
actions and compares every line against a settled pass over the same text. It
was the last shape reported after the variable half was fixed: over 1,200
whole-document comparisons the disagreements went from 8 to 4, and the 4 that
remain are a different shape still being read.
