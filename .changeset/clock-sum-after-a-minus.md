---
"solve-engine": patch
---

A clock sum after a minus is read left to right

The rule that adds bare clock times (`8:15 + 7:45`) fused any run of them joined by `+`, without looking at what came before it. After a minus that took the wrong times: in `17:30 - 9:00 + 0:45` it fused `9:00 + 0:45` into 585 minutes, and the line read as `17:30 - 585 minutes`, a time of day (#628). A run is now fused only where a sum can start (the start of an expression, or after a bracket, an `=`, a comma or another `+`), and a run added to a clock subtraction is a length of time added to that shift, which stays a span.

| line | before | now |
| --- | --- | --- |
| `17:30 - 9:00 + 0:45` | 7:45 AM today | 9:15 |
| `18:00 - 12:55 + 1:00 + 0:30` | 3:35 AM today | 6:35 |
| `(9:30 - 8:30) + 1:00` | 2:00 AM today | 2:00 |

The sums the rule was written for are unchanged (`8:15 + 7:45 + 8:30` is 1,470 minutes), and so is a bracket that asks for the other reading: `17:30 - (9:00 + 0:45)` is still a time of day, 9:45 before half past five. After a `*` or `/` the run is left to precedence, so `2 * 1:00 + 0:30` multiplies a time of day, which is refused by name.

The timesheets page shows a shift with overtime added.

## Verification

A new spec pins each shape through both document passes, including a column of them under `total above`, the boundary cases, and every operator in front of a run; the time suites pass unchanged.
