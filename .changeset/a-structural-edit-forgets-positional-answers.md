---
"solve-engine": patch
---

An insert or a delete that creates a positional cycle reports it

A line that reads a position (`prev`, `line 7`, a range, the `above`
aggregates, a table column) is marked dirty when an insert or a delete moves
what that position holds. That says it must run again. It does not stop another
line reading what it said in the meantime, and what it said was about a document
that no longer exists.

| document                    | action                | before  | now                   |
| ---                         | ---                   | ---     | ---                   |
| `:v = 46` / `average above` | insert `line 3 + 5`   | `54.75` | `Line 3 has an error` |

The inserted line reads line 3, and line 3 averages the block above it, which
now contains the inserted line. Given a value to start from, the two chased each
other by a smaller amount each pass, so `54.75` was not an answer at all, it was
a snapshot of an unfinished iteration: the same document left alone gave a
different number every pass. A structural edit now takes those lines' answers
with it, so neither has anything to chase, both report the cycle, and the
document is still.

Only the lines that read a position, and only on a structural edit. An ordinary
edit leaves every position meaning what it meant, so a reader's answer is still
about this document, and taking it away would show an error to whoever asked
before it ran again.

Two wider rules were tried against the differential fuzz and both made it worse,
which is why the narrow one shipped. Refusing to read a dirty line at all fixed
the cycle and traded it for `total of #food` reporting the tagged line below it
as unevaluated. Forgetting the answers of every reader of every changed position
produced six times as many disagreements as it fixed.

The boundary, measured rather than assumed: a cycle an *ordinary* edit creates is
not covered, because this is keyed to the structural change. Over 3,200 random
editing sessions it is now the only shape the fuzz reports, at roughly one
session in six hundred, down from every kind of positional staleness before.

The fuzzer's oracle changed with it. Both sides now run until their answers stop
moving rather than for a fixed three passes, because a forward reference resolves
one hop per pass and a fixed count reported the oracle's own impatience as an
engine fault.

## Verification

7 new tests: an insert and a delete each reporting the cycle, the document
staying still over eight further passes, a cycle written from the start still
reported, an aggregate below an insert still answering, an ordinary edit keeping
its reader's answer, and a document with no positional reader untouched.
