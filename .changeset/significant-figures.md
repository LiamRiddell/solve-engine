---
"solve-engine": minor
---

Significant figures, engineering notation and compact form

A line can now round to significant figures, and write a number in engineering notation or in the compact form a report headlines. `to N sf` rounds the way `to N dp` does, counting figures from the first digit that is not zero, which is how a measured value is reported. `as engineering` is scientific notation with the exponent kept to a multiple of three, the steps the metric prefixes take. `as compact` writes 3,300,000 as `3.3M`.

| expression | before | now |
| --- | --- | --- |
| `1234567 to 3 sf` | error: Undefined variable: sf | 1,230,000 |
| `0.0012345 to 2 sf` | error | 0.0012 |
| `2.5 to 3 sf` | error | 2.50 |
| `1234567 to 3 significant figures` | error: Unexpected token "figures" | 1,230,000 |
| `12345 as engineering` | error: Unknown converter | 12.345e+3 |
| `3 million + 10% as compact` | error: Unknown converter | 3.3M |
| `$3300000 as compact` | error: Unknown converter | $3.3M |

Significant figures show a trailing zero that is one of them (`2.5 to 3 sf` is 2.50), and a rounding that carries into the next power of ten keeps the count (`9.99 to 2 sf` is 10). An exact decimal rounds half away from zero, as `to N dp` does, and a unit or a currency is kept. `sf`, `sig figs`, `sig fig`, `significant figures` and `significant digits` are all spellings; `to N digits` is unchanged and still means decimal places.

Compact form rounds to three significant figures and uses the suffix letters the engine reads back as input, `k`, `M`, `B` and `T`, so `3.3M` typed back in is 3,300,000 again. A thousand is a lowercase `k`, since `K` is kelvin. A figure that rounds up to the next suffix takes it (999,950 is `1M`), money keeps its symbol in front, and a quantity its unit after.

The boundary: both notations answer text, as `as scientific` does, so they end a line rather than feed further arithmetic. Compact form is a per-line request; the default rendering of large numbers is unchanged, and a global setting for it remains undecided. The figure count for `to N sf` runs from 1 to 17, the most a double carries.

## Verification

A new suite pins each rounding above including the carries, the exact-decimal half, every spelling, units and money, the refused count, and the unchanged `to N dp` and `to N digits`; engineering and compact form are pinned directly and through the engine, including the suffix round trip and a refused text value. The rounding and decimals pages gain proven examples. `npm run verify:ci` passes: TESTS tests across SUITES suites.
