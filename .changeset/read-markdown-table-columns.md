---
"solve-engine": minor
---

Markdown table columns can now be read as data.

A markdown table was the one block the engine saw and skipped. A separator row was classified and ignored, and a data row was handed to the evaluator, which errored on the pipes, so a note could hold a table of numbers and none of them could be totalled from where they sat.

A column can now be named and aggregated in place:

```
| item | cost |
| ---- | ---- |
| rent | 1200 |
| food |  300 |
| taxi |   12 |

sum of column "cost" in table above       was an error, now 1,512
average of column "cost" above             was an error, now 504
```

`min`, `max`, `count`, and `median of column` read the same column, `total of column` and `mean of column` are accepted as synonyms of sum and average, and the result is an ordinary number, so `sum of column "cost" above + 100` adds to it.

The decisions this slice makes, each surfaced as behaviour rather than left implicit:

- **Addressing** is the nearest table above the query line. `sum of column "cost"`, `sum of column "cost" above`, and `sum of column "cost" in table above` all resolve the same way. An explicit table label is deferred.
- **Non-numeric cells** are skipped, not errored, so a label row or a blank cell does not break an otherwise-numeric column. A column with no numbers at all, or a name that is not one of the headers, is a clear coded error rather than a silent zero.
- **Currency and units in cells** are not read yet: a `$50` or `50 kg` cell is treated as non-numeric and skipped. Plain numbers first, on purpose, since reading the units is the larger, more useful version.

Only tables whose rows begin with a pipe are recognised. The borderless form (`item | cost` with no leading pipe) is deferred, because a bare `a | b` line is ambiguous with a bitwise-or expression and needs cross-line context to tell the two apart. Existing per-line classification of table rows is unchanged.
