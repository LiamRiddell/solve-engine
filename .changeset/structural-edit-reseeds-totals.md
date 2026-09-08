---
"solve-engine": patch
---

A running total is re-seeded after a line is inserted or deleted

`spent += 5` re-applies its delta over whatever the total currently holds, so a
pass resets each total to its seed and re-runs every line that touches it. The
step that finds those lines asked the dependency graph what each one writes, and
a structural edit clears the graph and lets the next pass rebuild it. On the
pass that follows an insert or a delete the graph therefore answered nothing at
all, no line was marked, none re-ran, and the totals below the edit kept the
previous pass's sum:

| document                                       | before | now |
| ---                                            | ---    | --- |
| `spent += 7`, with `spent += 2` inserted above | `7`    | `9` |

A line's own write set is recorded on the line and survives the edit, so that is
what it reads now.

Found by a differential fuzz that drives random documents through random editor
actions, insert, delete, edit and scroll, and compares every line against a
settled pass over the same text. Over 900 whole-document comparisons it was the
last remaining case of two different numbers; what is left after it is the known
staleness of a definition whose line has been removed, which is filed separately.

## Verification

5 new tests: an accumulator inserted above another being counted, one deleted
from the middle no longer counting, a total not growing when the same text is
evaluated again, several edits in a row each leaving the total right, and two
totals kept apart. Four of the five fail without the fix.
