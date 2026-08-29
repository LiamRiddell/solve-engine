---
"solve-engine": minor
---

Add the second tier of statistics (issues #244, #245).

The statistics page had a list's centre and spread; this adds the relationship
between two lists, and position within one. A new `solve-statistics` package, on
by default and removable, alongside the existing maths-phrases aggregates.

## Relationships between two lists

| expression | result |
| --- | --- |
| `correlation of [1, 2, 3, 4] and [2, 4, 5, 8]` | `0.98` |
| `slope of [1, 2, 3, 4] and [2, 4, 5, 8]` | `1.90` |
| `intercept of [1, 2, 3, 4] and [2, 4, 5, 8]` | `0` |
| `rsquared([1, 2, 3, 4], [2, 4, 5, 8])` | `0.96` |

Correlation is Pearson's coefficient (-1 to 1); slope and intercept are the
least-squares line of best fit; r squared is the share of variation it explains.
Each two-list form also has a call spelling.

## Position and the normal distribution

| expression | result |
| --- | --- |
| `percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)` | `9.10` |
| `zscore(9, [2, 4, 4, 4, 5, 5, 7, 9])` | `2` |
| `normalcdf(1.96)` | `0.98` |
| `normalpdf(0)` | `0.40` |

Percentile uses linear interpolation (the NumPy default); `normalcdf` is the
standard-normal cumulative probability, via a published error-function
approximation. `median of ...` already ships in the maths-phrases package.

## The boundaries

Lists are `[bracketed]` vectors (or an integer range). Two lists of different
lengths, fewer than two points, or a percentile outside 0 to 100 are answered
with a structured Error rather than a wrong number. Standard deviations here use
the population form, matching the engine's existing `stdev`.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
new statistics examples are proven live). New tests:
`packages/statistics/StatisticsMath.spec.ts` and
`packages/statistics/StatisticsEngine.spec.ts`.
