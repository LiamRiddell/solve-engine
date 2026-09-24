---
"solve-engine": minor
---

Probability distributions: the inverse normal, binomial, Poisson and Student's t, with the error and gamma functions behind them

The statistics package had the normal distribution's cumulative probability and density and nothing else, so a note could not give a critical value, a confidence interval's margin or the chance of exactly 3 heads in 10 tosses without opening a spreadsheet. It now has the inverse normal, the binomial, Poisson and Student's t distributions, and the special functions they are built on, under the names a graphing calculator uses.

| expression | before | now |
| --- | --- | --- |
| `normalinv(0.975)` | error: undefined function | 1.96 |
| `normalinv(0.9, 100, 15)` | error: undefined function | 119.22 |
| `binompdf(10, 0.5, 3)` | error: undefined function | 0.12 |
| `binomcdf(10, 0.5, 3)` | error: undefined function | 0.17 |
| `poissoncdf(2, 3)` | error: undefined function | 0.86 |
| `tinv(0.975, 9)` | error: undefined function | 2.26 |
| `2 * (1 - tcdf(2.5, 12))` | error: undefined function | 0.03 |
| `erf(0.5)` | error: undefined function | 0.52 |
| `gamma(0.5)` | error: undefined function | 1.77 |
| `normalcdf(-8)` | 6.11e-16 | 6.22e-16 |
| `normalcdf(-10)` | 0 | 7.62e-24 |

Each distribution answers the three questions a note asks of one: `pdf` is the chance of one exact outcome (or, for a measurement, the height of the curve), `cdf` the chance of an outcome at or below a value, and `inv` the value a given share of outcomes falls below. The functions are `normalinv` (and `invnorm`), `binompdf` and `binomcdf`, `poissonpdf` and `poissoncdf`, `tpdf`, `tcdf` and `tinv` (and `invt`), and `erf`, `erfc`, `gamma` and `lgamma`. A probability can be written as a decimal or a percentage, and every result is an ordinary number, so a margin computed from `normalinv` or `tinv` can be written after a value with `±` and carried as its tolerance.

The last two rows are the existing `normalcdf`. It was built on a textbook approximation of the error function with an absolute error of 1.5e-7, which is fine near the middle of the curve and wrong in the tail: 1.8% out at z = -8, and 0 at z = -10. The error function is now a series near zero and a continued fraction in the tail, so a far-tail probability keeps its significant digits, and every function here is accurate to at least ten significant figures. Up to 50 trials a binomial is summed term by term, so a fair coin's answers are exact: `binomcdf(10, 0.5, 3)` is 176/1024 to the last digit.

Every argument is checked against its distribution's rules, and one outside them is refused by name rather than passed to a formula that would produce a number anyway: a probability outside 0 to 1 (`STAT_PROBABILITY_RANGE`), a fractional or negative count (`STAT_NOT_WHOLE`, `STAT_COUNT_RANGE`), more successes than trials, a standard deviation, average or degrees of freedom that is not positive, gamma at zero or a negative whole number (`STAT_GAMMA_POLE`), and an answer past the largest number a double holds (`STAT_OVERFLOW`). More successes than trials is refused rather than answered 0 because it is far more often a spreadsheet's argument order (`BINOM.DIST` puts the successes first) than a real question.

The boundary: the argument order is a graphing calculator's, value first for a measurement (`tcdf(t, df)`) and count last for a count (`binompdf(n, p, k)`, `poissonpdf(mean, k)`). A spreadsheet's `POISSON.DIST` takes the count first, and since both orders are valid calls that one mix-up cannot be caught. `tinv` is left-tailed like `T.INV`, not two-tailed like an older spreadsheet's `TINV`. The calculator's range forms, `normalcdf(lower, upper, mean, sd)` and `tcdf(lower, upper, df)`, are refused by argument count; the difference of two calls gives the same share. Very large counts cost precision: past about a hundred billion trials the binomial's cumulative answers keep fewer than ten digits (about seven at a thousand trillion), and past an average of about twenty billion a Poisson cumulative answer can be refused (`STAT_NO_CONVERGENCE`) rather than approximated. Each new name followed by `(` is a call, so `gamma(x) = ...` cannot define a function of that name; `gamma` without brackets is still free as a variable. Other distributions (chi-square, F, exponential, uniform) are not part of this change.

The normal distribution moves from the statistics page to a new probability distributions page with the rest, which explains each distribution before its syntax.

## Verification

A new spec pins every function against reference values computed independently with mpmath at 40 digits, including far tails, huge counts, degrees of freedom from 0.3 to 10^17, and the gamma function's reflection and overflow; it checks that each quantile inverts its CDF, that each cumulative probability is the sum of its masses, that the t distribution meets the Cauchy at one degree of freedom and the normal at many, and that every refusal returns its code as a value rather than throwing. The new page's examples are proven by the documentation suite. `npm run verify:ci` passes: 10,709 tests across 517 suites.
