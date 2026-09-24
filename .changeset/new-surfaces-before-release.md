---
"solve-engine": patch
---

Only a `check` line counts as a check, a check across an offset conversion agrees with `==`, renumbering moves what-if and sweep targets, a trace lists what sections and tables read, and a result goes through `JSON.stringify`

Five defects in surfaces that first ship in this release, found by the design review for 3.0 while they could still change without breaking anyone (#594 to #598).

**Only a line written with `check` counts as a check (#594).** A pass was recognised by its answer alone, any text beginning with a tick, so a line of text such as `"✓ shipped"` added to the host's pass count and `total above` stepped over it. A check is now a line written with the `check` keyword and answered with a check's tick or its failure.

| document | before | now |
| --- | --- | --- |
| `"✓ shipped"`, then `check 1 == 2` | checks: 1 passed, 1 failed | checks: 0 passed, 1 failed |

**A check across an offset conversion agrees with `==` (#595).** 32 F in Celsius is 5.7e-14 rather than 0, because the offset arithmetic runs in binary. `==` allows for that by scaling its margin with the sides as written; a check scaled it by the two converted values, both near zero, and failed.

| line | before | now |
| --- | --- | --- |
| `check 0 C == 32 F` | error: check failed: 0.0000000000000 C is not equal to 32.0000000000000 F | ✓ |

**Renumbering moves what-if and sweep targets (#596).** `shiftLineReferences` renumbered a plain `line N` but not the line a what-if or a sweep re-runs, since those fuse their `line N` into a token of their own. After a line was inserted above, `line 2 with x = 5` quietly re-ran whatever had moved into line 2. It is now renumbered with the rest, and a target whose line was deleted says so, as a plain reference does.

| after inserting a heading above | before | now |
| --- | --- | --- |
| `line 2 with x = 5` | left as `line 2`, now reading `x = 1` | `line 3 with x = 5`, same answer |
| `line deleted with x = 5` | error: There is no line NaN to re-run | error: This reference pointed at a line that has been deleted |

**A trace lists what sections and tables read (#597).** `inputs of line N` read line references, ranges, `above` and tags, so a section total and a table read reported that they read no other line, and `total above` listed the check line it had stepped over. A section total now lists the lines under its heading, a table read lists the table's rows by their labels, and a total's trace leaves out the lines the total leaves out.

| line | before | now |
| --- | --- | --- |
| `inputs of line 6` (a column lookup) | c 10 (line 6) reads no other line | c 10 (line 6) <- food (line 3), rent (line 4) |
| `inputs of line 4` (a total over a check) | 15 (line 4) <- 10 (line 1), ✓ (line 2), 5 (line 3) | 15 (line 4) <- 10 (line 1), 5 (line 3) |

**A result goes through `JSON.stringify` (#598).** A value with an exact sidecar threw "Do not know how to serialize a BigInt". A typed decimal always had one; exact decimals and exact large integers put one on most computed answers too, so in this release most results with a decimal point, and every whole number past 2^53, would have stopped serialising. `Value.toJSON()` writes `type`, `value` and `unit`, then each sidecar that is set, with bigints as strings.

| expression | before | now |
| --- | --- | --- |
| `JSON.stringify(0.1 + 0.2)` | throws: Do not know how to serialize a BigInt | `{"type":0,"value":0.3,"exact":"0.3"}` |

The boundary: a table lookup reads one row, but its key can come from another line, so the trace lists the rows it chose among rather than guessing the one it picked. A `check` after a label (`Budget: check a < b`) still does not parse; that is a separate gap. `Value.toJSON()` is for reading a result, not a snapshot format; `engine.toJSON()` is the one that restores.

The conditionals, tracing, reference-aware editing and TypeScript pages change with these.

## Verification

New tests pin the check count through both document passes, checks across offset conversions, the renumbered and deleted what-if and sweep targets with their answers before and after, the section, table and `total above` traces through both passes in CrossPathDocumentFeatures, and the JSON of each kind of sidecar. `npm run verify:ci` passes.
