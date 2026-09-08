---
"solve-engine": patch
---

`getDependencies` says what it answers

`DependencyGraph.getDependencies` was documented as "all variables that a line
depends on (reads)". It is not. The map behind it is filled only on the branch
of `registerLine` that stores a write set, so a line that reads a name and
defines nothing answers with an empty set rather than with what it reads.

That behaviour is deliberate, and pinned by a test: it is what lets a
redefinition break the old chain rather than depend on itself. It is also a trap,
and it has been walked into. The async batcher ordered the lines it was about to
re-run by asking this what each one read, and a line defining nothing answered
with nothing and got no ordering constraint at all, so `rate * 2` ran before the
line that fetched `rate` and read the value from before the fetch. That fault
was fixed in 2.38.11 by asking `getReads` instead; this is the doc that would
have stopped it being written.

No behaviour changes. The doc block now states the qualifier first, says why the
behaviour is what it is, names the fault it caused, and points at `getReads` as
the question almost every caller means.

## Verification

4 new tests pinning the difference the doc now describes: `getDependencies`
answering nothing for a line that writes nothing, `getReads` answering whether
or not the line writes, a pinned data-source key appearing in one and not the
other, and an unknown line answering empty.
