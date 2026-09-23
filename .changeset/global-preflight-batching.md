---
"solve-engine": patch
---

A line reading several not-yet-declared cross-document values waits once, not once per value

`GlobalVariableAsyncResolver.preflight` scans a line's bytecode for `global :name` reads whose name no
loaded document has declared yet, and returned at the first one it found. The engine then showed the
line as pending, waited for that single name, re-executed the line, discovered the second name was
still missing, and waited again.

So a line reading three undeclared names needed three full pend-and-re-execute round trips before it
could produce an answer, and each round trip re-ran the whole line. The scan already walked the entire
program, so every one of those names was seen on the first pass and then discarded.

The scan now collects them all and waits on all of them together. The names are deduplicated and
ordered, so a line reading the same name twice waits once, and two lines reading the same pair agree
on one key whichever order they read them in, which matters because that key is registered as a
dependency and not only used as a label.

A line with exactly one unresolved name is unchanged in every respect, including the spelling of its
key.

The waiting is for all of them rather than the first to arrive, because a line cannot produce an
answer until every name it reads exists; resolving early would re-execute it straight back into the
state it just left, which is the behaviour being replaced. A name that nobody ever declares leaves the
line pending indefinitely, exactly as a single one always did. There is deliberately no timeout here
and that has not changed.

## Verification

Three tests: that two of three names arriving does not settle the wait while the third is outstanding,
that a name read twice collapses to one wait and keeps the single-name key, and that the composite key
does not depend on read order. The first and third fail before this change. `npm run verify` passes:
479 suites, 9,124 tests.
