---
"solve-engine": patch
---

A blank line or a heading inside a summed range is passed over, and a line below is described as the refusal it is

`sum(line 1 : line 3)` read every line in the span and took a line with no answer for a forward reference, so a blank line inside it, typed by pressing Enter in the middle of a column, turned the sum into an error. A blank line or a heading now has no figure to add and is passed over, the way a spreadsheet's `SUM` passes over an empty cell, in both document passes.

| document | before | now |
| --- | --- | --- |
| `10`, blank, `30`, `sum(line 1 : line 3)` | Line 2 has not been evaluated yet | 40 |
| `10`, `# Mid`, `30`, `average(line 1 : line 3)` | Line 2 has not been evaluated yet | 20 |
| blank, blank, `sum(line 1 : line 2)` | Line 1 has not been evaluated yet | error: lines 1 to 2 hold no figures to add up |

The line references page also said that `line 2 + 1` above `7` answers 8. It does not: a line below is refused in both passes, as the page's own cycle example shows, and the page now says so with a proven example.

The boundary: only a blank line or a heading is passed over. A line of prose inside the span is a line that failed, and still makes the sum an error, and a span that runs past the last line still reports the first line that is not there.

Fixes #562 and #563.

## Verification

The cross-path spec pins a span over a blank line and a heading, an empty span and a span past the end through `parseDocument` and `evaluateDocument`, which agree. The line references page gains both as proven examples. `npm run verify:ci` passes: TESTS tests across SUITES suites, with the bundled-consumer contract.
