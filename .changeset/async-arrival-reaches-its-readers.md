---
"solve-engine": patch
---

A value arriving reaches the lines that read it

When a data source resolves, the batcher re-executes the lines the dependency
graph names for that query key. That set was the direct consumers of the key and
was never expanded, so a line reading a variable the fetching line defines kept
the number from before the fetch:

| line                    | before        | now           |
| ---                     | ---           | ---           |
| `:rate = 100 USD in EUR` | updates       | updates       |
| `rate * 2`              | stays as it was | updates too |

until something else re-evaluated the document. The set is now closed over the
graph: everything that reads what those lines write, and so on.

Expanding it surfaced a second fault in the ordering, which is why the first
attempt still answered with the old value. The batcher sorts the lines it is
about to run so producers come before consumers, and it asked
`getDependencies` for what each line reads. That map is only filled alongside a
line's write set, so a line that defines nothing answered with nothing, and a
line that defines nothing is exactly the line whose reads decide where it goes.
`rate * 2` was ordered before the line that fetched `rate`. The graph now
answers `getReads`, which is every key a line reads whether or not it writes
anything, and the sort asks that instead.

The boundary is the VM those lines run against. The batcher deliberately does
not reset it, so a re-run reads whatever the last full pass left behind, and for
a name written on more than one line that is the last write rather than the one
governing the re-run line's position. Reconstructing that prefix needs the
checkpointer, which nothing on this path builds yet. Positional reads
(`prev`, `total above`, `line N`) register no edge at all and so still cannot be
named; that is tracked separately.

## Verification

4 new tests: a line reading the fetched value being re-run, the same to any
depth with the values proving the order, a line reading something unrelated
being left alone, and a cycle between two readers terminating the walk. Two of
the four fail without the fix, and the depth one fails for both reasons in turn.
