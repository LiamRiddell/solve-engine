---
"solve-engine": patch
---

Percentages: one scale with permille and ppm, `as % of` asks for the rate, `on` and `off` take the percentage before them, a change needs a base with a size, and a percentage is formatted like any other figure

Five percentage faults from the 2026-09-25 survey. Each gave a confident answer to a sum people type often.

**Percent is on the parts-per scale (#633).** A percent is one part in a hundred, a permille one in a thousand and a part per million one in a million, but percent sat outside that scale. `in %` left the `%` for the postfix operator, which divided by a hundred again; `as %` read a quantity's magnitude and dropped its unit; and `of` multiplied a parts-per quantity by its magnitude.

| line | before | now |
| --- | --- | --- |
| `20/80 in %` | 0.25% | 25.00% |
| `0.25 to %` | error: No prefix parselet found for token: PERCENT | 25.00% |
| `100 ppm as %` | 10000.00% | 0.01% |
| `0.5% in ppm` | 0.01 ppm | 5,000.00 ppm |
| `2 permille of $5000` | $10,000.00 | $10.00 |
| `5 km as %` | 500.00% | refused: a length is not a proportion |

Only `of` reads a parts-per quantity as a rate; `*` keeps its unit, so `2 permille * 5000` is still 10,000 permille, the same amount as 10.

**`as % of` asks for the rate (#634).** `40 as % of 50` converted 40 to 4000% and took that of 50. `as %`, `as percent` and `as a %` with a base now ask what `is what %` asks, through the same code.

| line | before | now |
| --- | --- | --- |
| `40 as % of 50` | 2,000 | 80.00% |
| `$60 as % on $50` | $3,050.00 | 20.00% |
| `$40 as a % of $50` | error: Unknown converter "as a" | 80.00% |

**`on` and `off` take the percentage just before them (#635).** They bound below arithmetic on their left, so the rate was whatever had been built there, and a chain grouped to the left. The rate is now the percentage before the word, the base is everything after it, and a chain groups to the right. `explainLine` follows the same grouping.

| line | before | now |
| --- | --- | --- |
| `5 + 20% off 100` | -500 | 85 |
| `10% off 20% off $100` | $82.00 | $72.00 |
| `10% on 10% on 100` | 111.00 | 121 |

The base still reaches to the end: `10% off 100 + 100` is 180.

**A percentage change needs a base with a size and a sign (#636).** A change from zero divided by zero, and a change from a negative base picked a sign for a question with two conventional answers.

| line | before | now |
| --- | --- | --- |
| `0 to 10` | Infinity% | refused (`PERCENT_CHANGE_FROM_ZERO`) |
| `0 to 0` | NaN% | refused (`PERCENT_CHANGE_FROM_ZERO`) |
| `-100 to -50` | -50.00% | refused, naming both readings (`PERCENT_CHANGE_NEGATIVE_BASE`) |
| `40 is what % of 0` | Infinity% | refused (`PERCENTAGE_NOT_FINITE`) |

`10 to 0` is still -100.00%, a fall to nothing from a positive base, and `1/0` is still ∞: only a percentage of a value that is not finite is refused.

**A percentage is formatted like any other figure (#637).** The formatter used `toFixed` alone.

| line | before | now |
| --- | --- | --- |
| `0.001%` | 0.00% | 0.001% |
| `-0.001%` | 0.00% | -0.001% |
| `1234567%` | 1234567.00% | 1,234,567.00% |
| `1/8 as %`, formatted for de-DE | 12.50% | 12,50% |

A zero is still written without a sign (#585).

The percentages page is rebuilt around these forms, and also documents the ones it did not show (#683): discounts and markups, what percentage one number is of another, the original before a markup, and percent beside permille and ppm. The decimals page shows a percentage under the too-small rule.

## Verification

A spec for each issue pins its before/now lines and adversarial cases: a parts-per quantity in every conversion form, a percentage of a quantity, chains of `on` and `off`, a change from zero, a negative and a non-finite base, and percentages at the edges of the formatter (a tiny value, a huge one, a negative zero, a de-DE decimal mark). The full suite is 13,905 tests in 571 suites, all passing (four skipped), and `npm run verify:ci` passes, including `lint:dispatch-size`, the three-zone `test:temporal` run and the bundled-consumer contract.
