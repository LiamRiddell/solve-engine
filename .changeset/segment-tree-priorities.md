---
"solve-engine": patch
---

A document grown by editing stays a tree, so long documents stop crashing

The document's order tree took its node priorities from `pseudoRandom(mid)`,
where `mid` is the midpoint of the range being built. A single-line insert is
always a one-element build, so `mid` was always `0` — and zero is a fixed point
of that hash, surviving the shift, the xor and the multiply unchanged, so
`pseudoRandom(0)` was exactly `0`.

Every inserting edit therefore minted a node with the lowest priority a node can
have, and `merge` breaks ties the same way, so they chained into a strictly
linear spine. Depth equalled the number of edits.

| document grown by | before | now |
| --- | --- | --- |
| 1,000 appends | depth 1,001 | depth 23 |
| 4,000 appends | depth 4,001 | depth 24 |
| 16,000 appends | depth 16,001 | depth 32 |
| 4,000 prepends | depth 4,001 | depth 24 |
| 4,000 middle inserts | depth 4,002 | depth 24 |
| `setDocument` of 16,001 lines | depth 14 | depth 14 |

`nodeAt`, `split`, `merge`, `collectRange` and the iterator all recurse on that
depth, so reads overflowed the stack and the `RangeError` escaped to the caller
rather than arriving as an error Value: the scroll path at about 5,400 edits,
`getAllLines` at about 7,900, `ThreeTierEvaluator.evaluate` at about 8,000, and
the edits themselves at about 12,400. After the first overflow the model stayed
bricked. A document grown to 30,000 lines now reads without throwing.

Loading the same text in one `setDocument` always built a balanced tree, which is
what isolated the fault to the incremental path — the one a live editor uses.

Two things changed. The priority now comes from the line's own id rather than its
position in the build, because position carries no entropy across separate builds
while an id is unique and stable, so the same set of lines still produces the same
shape. And the hash offsets its seed by a large odd constant, so no input maps to
itself, with the result read as unsigned so the range really is `[0, 1)`.

The assertions are structural rather than timed: depth is a property of the tree,
so it is asserted exactly.
