---
"solve-engine": patch
---

An ISO date is read as ISO whatever `date.inputOrder` is set to.

`date.inputOrder` fixes how an ambiguous numeric date is read. `DMY` and `MDY` require a one- or two-digit leading group, so a hyphen date starting with a four-digit year matched no reading, the rule fell through, and the line became the arithmetic it is spelled identically to. A host that set `MDY` for its US readers turned every bare ISO date in every document into a subtraction, silently.

| expression, with `inputOrder: "MDY"` | before | now |
| --- | --- | --- |
| `2026-04-03` | `2,019` | `Friday, April 3, 2026` |
| `2026-04-03 + 1 day` | `2,020 day` | `Saturday, April 4, 2026` |
| `2024-5-3` | `2,016` | `Friday, May 3, 2024` |

A four-digit leading group is neither a day nor a month, so there is nothing there for an order to resolve: the ISO reading is now taken before the order is consulted at all. The `DateInputOrder` documentation already claimed this held.

The boundary is hyphens. A slash date starting with four digits (`2023/12/25`) is still claimed by `YMD` alone, which is what the input-order table on the date-literals page documents, and a spaced chain (`2024 - 5 - 3`) is still subtraction under every order.
