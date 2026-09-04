---
"solve-engine": patch
---

`convertUnit` refuses a pair that is not the same kind of thing, wherever the units came from.

It always refused one from the base table: `convertUnit(5, "kg", "metre")` throws. It did not refuse one from the extended table, and that branch multiplied the two units' base ratios without comparing their measures.

| | before | now |
| --- | --- | --- |
| `canConvert("mpg", "l100km")` | `false` | `false` |
| `convertUnit(35, "mpg", "l100km")` | `1488.002976005952` | throws `Cannot convert between different measures: mpg and l100km` |

Miles per gallon is distance over volume and litres per hundred kilometres is volume over distance, so the engine files them as different measures and `canConvert` has always said so. `convertUnit` did it anyway and returned a number with no meaning, which a first version of the travel package's trip arithmetic was built on: a 300-mile drive that burned 7,184 litres. The refusal now reads the same as the base table's, so one kind of mistake has one message.

The boundary is measures, not extended units. Two extended units of the same measure still convert (`convertUnit(35, "mpg", "kmpl")` is `14.88`), and reciprocal pairs still relate through `convertRate`, which is what it is for: `40 mpg in l/100km` is still `5.88 l/100km`, and `6 l/100km in mpg` is still `39.20 mpg`.

No expression changes. Every engine-level form already went through the paths that were correct; this closes the one a package author could reach for and be quietly wrong.
