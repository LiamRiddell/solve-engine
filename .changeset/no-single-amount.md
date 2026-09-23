---
"solve-engine": patch
---

A list cell, a conversion and arithmetic refuse a value with no single amount

Three places read a value through `toNumber()` as if every value had a number inside it. A bracketed list and a colour read as 0 that way, and text as its leading digits or 0, so each place answered with a plausible number that had nothing to do with the question. Each is now a named error.

| expression | before | now |
| --- | --- | --- |
| `[(1, 2), 3]` | [0, 3] | error: a list cannot hold a list inside it (`MATRIX_CELL_NON_NUMERIC`) |
| `["a", 1]` | [0, 1] | error: text cannot be a cell of a list |
| `(1, 2) in miles` | 0.00 miles | error: a bracketed list has no single amount to convert to miles (`CONVERT_NON_NUMERIC`) |
| `"11:00 PM" + 2` | 13 | error: text and a number cannot be added (`TEXT_ARITHMETIC`) |
| `"hello" + 5` | 5 | error: text and a number cannot be added |
| `"5" * 2` | 10 | error: text cannot be used in arithmetic |
| `"11:00 PM" as number` | 11 | error: not a number (`TEXT_NOT_A_NUMBER`) |
| `"1,234.5" as number` | 1 | 1,234.50 |

The last rows are the widest change. `"5" + 5` used to answer 10, which the text operations page documented, but a reader who writes it means either 10 or `55`, and a quoted time plus a number answered 13 with no sign that anything was wrong. Text still joins to text with `+`; any other arithmetic with text on either side is refused, and the message points at `as number`, the conversion for a number that arrives as text (a pasted value, a decoded query field). That conversion took the same `parseFloat` reading, so it now reads text only when the whole of it is a number, with commas grouping thousands allowed, and refuses anything else.

A list cell still holds a number, a `true` or `false`, or an unknown (a formula cell), and a conversion still takes a number, a quantity or a date. The refused kinds are the ones an aggregate has refused since #530: text, a date, a bracketed list, a range, a colour, an IP address, a chart and a split.

The boundary: a quantity in a list cell is still stored as its magnitude, so `[1 km, 2]` is `[1, 2]`. That drops the unit rather than inventing a number, and giving a list cell a unit is its own change.

Fixes #546, #547 and #549.
