---
"solve-engine": patch
---

Looking up a line by position no longer walks the order tree

A document keeps its line order in a balanced tree, so `getLineAt(position)`
turned a position into a line by walking it, an O(log n) recursion on every
call. The cross-line forms lean on that hard: `total above`, a line range and
every boundary check turn a position into a line this way, once for each line
they scan, on every pass. A profile of an editing session — the notepad's real
path, where a keystroke re-evaluates the document — put that one lookup at about
a quarter of the whole re-evaluation, the single largest cost in it.

Positions do not move between structural edits, so the lookup now reads a
cached ordered-id array and is an array index. The cache is built in the same
pass as the existing lineId→position map and invalidated with it, so an insert
or a delete rebuilds it and an ordinary keystroke, which changes a line's text
but moves no line, leaves it standing.

Measured on a 300-line document heavy with cross-line forms, a hundred edits
each followed by a re-evaluation, old and new run alternately in one process:

| build | median | fastest |
| ---   | ---    | ---     |
| before | 151.4 ms | 146.1 ms |
| now    | 121.6 ms | 115.4 ms |

About 18 to 20 per cent off the re-evaluation an edit triggers, stable across
runs and never slower.

The boundary: this is the lookup, not the work. The aggregates still read the
lines they cover and the VM still executes them; what is gone is the tree walk
that stood between a position and its line. The batch `parseDocument` path,
which reads lines by position too, gets the same lookup for free.

## Verification

5 new tests in `DocumentOrderCache` pin that `getLineAt` and `getLinePosition`
round-trip on a fresh document, that a text edit leaves the order standing (same
line id, same position), that an insert and a delete each rebuild it, and that a
run of structural and text edits stays consistent throughout. The engine suite
is green, and the differential fuzz of documents, expressions and bytecode
reports 0 disagreements, since the cache returns exactly what the tree did.
