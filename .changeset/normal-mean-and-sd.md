---
"solve-engine": patch
---

`normalcdf` and `normalpdf` take a mean and a standard deviation, and no statistics call drops an argument

`normalcdf` and `normalpdf` read only their first argument, so `normalcdf(110, 100, 15)` took 110 as a z-score and answered 1, and the mean and standard deviation were discarded without a word. Both now accept a value, a mean and a standard deviation, in the order a spreadsheet's `NORM.DIST` uses, and standardise the value as `(x - mean) / sd`. The one-argument forms on the standard normal are unchanged.

| expression | before | now |
| --- | --- | --- |
| `normalcdf(110, 100, 15)` | 1 | 0.75 |
| `normalpdf(110, 100, 15)` | 0 | 0.02 |
| `normalcdf(110, 100)` | 1 | error: takes 1 or 3 arguments |
| `normalcdf(110, 100, 0)` | 1 | error: a standard deviation must be greater than zero |
| `percentile([1, 2, 3], 50, 9)` | 2 | error: takes 2 arguments |
| `zscore(1, [1, 2, 3], 5)` | -1.22 | error: takes 2 arguments |
| `correlation([1, 2, 3], [2, 4, 6], [1, 1, 1])` | 1 | error: takes 2 arguments |

The density in the three-argument form is divided by the standard deviation, because it is a density per unit of the value rather than per standard deviation, so `normalpdf(100, 100, 15)` is 0.3989 / 15.

The same silent drop was in every statistics call form: each handler read the arguments it wanted and ignored the rest. Every one now checks its argument count and refuses any other with `STAT_ARGUMENT_COUNT`, naming the count it takes and an example call. The phrase forms (`correlation of A and B`) always pass two lists and are unaffected.

The boundary: the normal functions take one argument or three. Two are refused rather than guessed at, since a mean with no standard deviation has no scale. A graphing calculator's four-argument `normalcdf(lower, upper, mean, sd)` is not a form here, and is refused by count rather than misread; the difference of two calls gives the same share. The arguments are plain numbers, not quantities with units, and the results carry the existing error-function approximation, accurate to about seven decimal places. The inverse normal and the other distributions are #517. This change covers the statistics package's own functions; other packages' plugin functions validate their own arguments.

## Verification

New tests pin the three-argument answers against the standardised one-argument form, the density's scaling, each refusal and its code, and the argument-count guard across percentile, z-score and the two-list call forms, with the phrase forms unchanged. The statistics page gains proven examples for the mean-and-deviation form and a `solve-doc` block of the refusals. `npm run verify:ci` passes: 9,593 tests across 487 suites, with the bundled-consumer contract.
