---
"solve-engine": patch
---

The dependency walk visits each edge once, and orders against every producer

Two faults in the dependency graph, both invisible while every key had exactly
one writer, and both load-bearing the moment a key can have many, which is what
a category tag is: one key whose producers are the group's members.

**The walk was quadratic in producers by consumers.** `getAffectedLines` pushed a
key onto its queue once per line that wrote it, and rescanned that key's whole
consumer set on each pop. A tagged column with aggregates over it is exactly that
shape.

| tagged column | before | now |
| --- | --- | --- |
| 250 members, 250 aggregates | 1.1 ms | 0.2 ms |
| 500 + 500 | 0.9 ms | 0.2 ms |
| 1,000 + 1,000 | 4.5 ms | 0.5 ms |
| 2,000 + 2,000 | 15.5 ms | 0.8 ms |

Four times per doubling before, two times now: the walk is over the edges once.

**Ordering recorded one producer per key.** `getAffectedLinesInOrder` built a
key-to-producer map with last-seen-wins, so an aggregate got an ordering edge to
one member of its group and none to the rest. I could not construct an observably
wrong order while keys had single writers, which is why it survived; the edges
were incomplete by construction rather than by accident, and the spec pins the
completeness rather than the luck.

**Ordering ran through the key rather than between every pair.** Ordering a line
after everything it depends on means, for a key, ordering every reader after
every writer. Written as edges between lines that is one edge per pair, so the
same tagged column cost members times aggregates. The key is a node in the sort
now: every writer points at it and it points at every reader, which says the same
thing in members plus aggregates.

| tagged column, ordered | as pairs | through the key |
| --- | --- | --- |
| 250 + 250 | 6.4 ms | 0.8 ms |
| 500 + 500 | 8.4 ms | 0.8 ms |
| 1,000 + 1,000 | 32.6 ms | 1.7 ms |
| 2,000 + 2,000 | 150.7 ms | 2.6 ms |

**A lookup that misses allocates nothing.** `getConsumers`, `getProducers`,
`getDependencies` and `getWrites` each built a fresh empty `Set` on a miss, about
176 nanoseconds of pure garbage per call, and the evaluator misses once per line
that writes nothing on every pass. They share one empty set now, and return
`ReadonlySet`, which says what was already true: these hand back the graph's own
sets rather than copies.

| 1,000,000 lookups that miss | before | now |
| --- | --- | --- |
| `getWrites` | 176.0 ms | 2.0 ms |
| `getConsumers` | 179.7 ms | 1.5 ms |

**A line whose edges have not moved is left alone.** Re-registering unhooked
every old edge and hooked the same ones back up, allocating a set or three doing
it, and that is the editor's ordinary case rather than a rare one, since a line
re-runs because a value it reads changed while its own text, which is where its
edges come from, did not.

| 20,000 re-registrations | before | now |
| --- | --- | --- |
| one read, one write | 31.9 ms | 4.9 ms |
| five reads, one write | 27.4 ms | 2.2 ms |
| no edges at all | 8.9 ms | 3.8 ms |

Fresh registration is unchanged. The comparison is deliberately conservative:
duplicate names make the stored set smaller than the array, and it falls through
to the full path rather than guessing.

Two smaller corrections came with it. A line that stops writing now drops its
recorded dependencies as well as its writes, since `dependencies` is only ever
written alongside `writes` and leaving it behind kept a set describing a line
that no longer defines anything.

End to end, a 2,000-line document whose every line reads one definition costs
3.5 ms per keystroke against 4.4 ms, about a fifth less. The larger multiples
above are the graph in isolation; the graph is one part of a pass.

Registration, removal, and the chain and fan shapes were measured before and
after and are unchanged: they were already linear.
