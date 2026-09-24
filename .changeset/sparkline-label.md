---
"solve-engine": patch
---

A sparkline's label reads as its list does, at the same decimal places

The text a sparkline answers with, which a reader with no canvas sees, was built from the list's raw digits, so it disagreed with how the same list reads on its own line.

| expression | before | now |
| --- | --- | --- |
| `[1.23456, 2.5, 3.14159] as sparkline` | [1.23456, 2.5, 3.14159] | [1.23, 2.50, 3.14] |
| `[120, 135, 128] as sparkline` | [120, 135, 128] | [120, 135, 128] |

The drawn points keep their full precision; only the label is written at the display places. The boundary: the label uses the default formatting, as the value is built before a host's display settings are known.

Fixes #558.

## Verification

The chart spec pins the label against the list's own display, and the charts page gains a fractional list as a proven example. `npm run verify:ci` passes: 10,723 tests across 518 suites, with the bundled-consumer contract.
