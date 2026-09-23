---
title: Probability distributions
description: The normal, binomial, Poisson and Student's t distributions, their inverses, and the error and gamma functions behind them.
---

> **Package:** `STATISTICS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A **probability distribution** describes how likely each outcome of a chance
process is: how often ten tosses of a fair coin give exactly three heads, how many
calls a help desk takes in an hour, how far one measurement strays from the
average of many. Each distribution here answers three questions, and the end of
the function's name says which:

- **`pdf`** is the chance of one exact outcome, such as exactly three heads. For
  a measurement that can take any value, where no single value has a chance of its
  own, it is instead the height of the curve at that point (the *density*).
- **`cdf`** is the *cumulative* chance: the probability of an outcome at or below
  the value, such as three heads or fewer.
- **`inv`** runs the cumulative question backwards: given a probability, it finds
  the value that share of outcomes falls at or below.

```solve
binompdf(10, 0.5, 3) // 0.12
binomcdf(10, 0.5, 3) // 0.17
normalinv(0.975) // 1.96
```

The names are the ones a graphing calculator uses, and so is the order of the
arguments. A distribution of measurements takes the value first and its
parameters after (`normalcdf(x, mean, sd)`); a distribution of counts takes its
parameters first and the count last (`binompdf(trials, p, successes)`).

## The normal distribution

The **normal distribution** is the bell curve much natural data follows:
heights, test scores, measurement errors. It is centred on its mean, and its
**standard deviation** says how wide it is. The *standard* normal has a mean of 0
and a standard deviation of 1, and a value measured on it is a **z-score**: how
many standard deviations it sits above or below the mean.

`normalcdf(z)` gives the share of the standard curve to the left of a z-score,
so `normalcdf(1.96)` is about 0.975, the basis of a 95% interval. `normalpdf(z)`
gives the height of the curve at that point.

```solve
normalcdf(1.96) // 0.98
normalpdf(0) // 0.40
```

Real data rarely comes as z-scores. Give a value, a mean and a standard deviation
instead, in that order (the order a spreadsheet's `NORM.DIST` uses), and the
value is standardised for you: with IQ scores averaging 100 and a standard
deviation of 15, `normalcdf(110, 100, 15)` is the share of people scoring 110 or
less. `normalpdf` in this form gives the height of that curve, which is per point
of the score, so it is smaller the wider the spread.

```solve
normalcdf(110, 100, 15) // 0.75
1 - normalcdf(130, 100, 15) // 0.02
normalpdf(110, 100, 15) // 0.02
```

The second line is a chance *above* a value: the whole curve is 1, so the share
above 130 is 1 minus the share below it.

### Going the other way

`normalinv` answers the reverse question: which value has a given share of the
curve below it. On the standard curve it gives the z-score, which is where the
1.96 of a 95% confidence interval comes from (2.5% of the curve lies above it and
2.5% below -1.96). With a mean and a standard deviation it gives a value on that
scale, such as the IQ score 90% of people fall below. The probability can be
written as a decimal or as a percentage. `invnorm` is the same function under a
graphing calculator's name.

```solve
normalinv(0.975) // 1.96
normalinv(97.5%) // 1.96
normalinv(0.05) // -1.64
normalinv(0.9, 100, 15) // 119.22
invnorm(0.5) // 0
```

A **confidence interval** puts a margin either side of an average measured from a
sample, wide enough to cover the true average in 95% of samples. An average of n
measurements typically strays from the true one by the standard deviation
divided by √n (its *standard error*), and when the standard deviation is known
the 95% margin is 1.96 of those. Written after a value with `±`, the margin is
carried as that value's tolerance, the form the
[uncertainty](/syntax/uncertainty/) page describes:

```solve-doc
sd = 15
n = 100
margin = normalinv(0.975) * sd / sqrt(n) // 2.94
120 ± margin // 120 ± 2.94
```

Arithmetic on a tolerance combines it as a standard deviation would be, which for
margins taken at the same confidence level gives the margin of the result at that
level too.

## The binomial distribution

A **binomial distribution** counts successes in a fixed number of independent
tries that each succeed with the same probability: heads in ten tosses, faulty
parts in a batch of 50, visitors out of 200 who click. It takes the number of
tries, the chance of success on each, and the number of successes asked about.
`binompdf` is the chance of exactly that many; `binomcdf` is the chance of that
many or fewer.

```solve
binompdf(10, 0.5, 3) // 0.12
binomcdf(10, 0.5, 3) // 0.17
1 - binomcdf(10, 0.5, 7) // 0.05
binompdf(50, 2%, 1) // 0.37
```

The third line is the chance of 8 heads or more: 1 minus the chance of 7 or
fewer. The last is a 2% fault rate over a batch of 50 giving exactly one faulty
part. Up to 50 tries each chance is worked out term by term, so a fair coin's
answer is exact: three heads or fewer in ten tosses is 176/1024, every digit of
it.

```solve
binomcdf(10, 0.5, 3) to 7 dp // 0.1718750
```

The number of tries and the number of successes are whole numbers, and the
successes run from 0 to the number of tries. More successes than tries is
refused rather than answered 0, because it is far more often the arguments in
another order (a spreadsheet's `BINOM.DIST` puts the successes first) than a real
question.

## The Poisson distribution

A **Poisson distribution** counts events that happen independently at a steady
average rate, where there is no fixed number of tries: calls to a help desk in an
hour, typing errors on a page, arrivals at a queue in a minute. It takes that
average count and the count asked about. `poissonpdf` is the chance of exactly
that many; `poissoncdf` is the chance of that many or fewer.

```solve
poissonpdf(2, 3) // 0.18
poissoncdf(2, 3) // 0.86
1 - poissoncdf(4, 7) // 0.05
poissonpdf(4, 0) // 0.02
```

A desk that averages 2 calls an hour takes exactly 3 in about 18% of hours and 3
or fewer in 86%. One averaging 4 sees 8 or more in about 5% of hours, and none at
all in 2%. The average comes first and the count last, as in `binompdf` and on a
graphing calculator; a spreadsheet's `POISSON.DIST` puts the count first. Both
orders are valid calls, so this is the one mix-up that cannot be refused: check
which number is the average.

## Student's t distribution

The **t distribution** is the bell curve to use when the standard deviation is
not known but estimated from the sample itself, as it is in almost every real
test on a small set of measurements. Its tails are fatter than the normal's, to
allow for the extra uncertainty, and how much fatter depends on the **degrees of
freedom**: for an average taken from a sample, the number of measurements minus
one. As the degrees of freedom grow the t distribution becomes the normal.

`tinv(p, df)` gives the **critical value**, the t below which a share p of the
curve lies, which is what a confidence interval or a t-test needs. `tcdf(t, df)`
gives the share of the curve at or below t, and `tpdf(t, df)` its height. `invt`
is `tinv` under a graphing calculator's name.

```solve
tinv(0.975, 9) // 2.26
invt(0.975, 9) // 2.26
tinv(0.975, 1000) // 1.96
tcdf(2.262, 9) // 0.97
tpdf(0, 5) // 0.38
```

With ten measurements (nine degrees of freedom) the 95% critical value is 2.26
rather than the normal's 1.96; with a thousand it is all but the same. A margin
from a sample's own standard deviation uses it in place of `normalinv`:

```solve-doc
count = 10
s = 4.2
margin = tinv(0.975, count - 1) * s / sqrt(count) // 3.00
52.3 ± margin // 52.3 ± 3.0
```

A **p-value** is the chance of a result at least as extreme as the one measured,
if there were really no effect. For a t statistic of 2.5 on 12 degrees of
freedom, the two-sided p-value counts both tails:

```solve
2 * (1 - tcdf(2.5, 12)) // 0.03
```

`tinv` is left-tailed, like a spreadsheet's `T.INV` and a calculator's `invT`:
`tinv(0.05, 10)` is the value 5% of the curve lies below. An older spreadsheet's
`TINV(0.05, 10)` is two-tailed, splitting the 5% between both ends, and gives
2.23, which here is `tinv(0.975, 10)`:

```solve
tinv(0.05, 10) // -1.81
tinv(0.975, 10) // 2.23
```

The degrees of freedom need not be whole (a Welch t-test, which compares two
samples with different spreads, gives fractional ones), but must be greater than
zero.

## The error and gamma functions

These are the special functions the distributions are built from, available in
their own right because engineering and physics formulas use them directly.

The **error function** `erf(x)` is the share of a bell curve lying within x of its
centre, measured on the scale physicists use (a normal with a standard deviation
of 1/√2), so it runs from -1 to 1. It appears in diffusion, heat flow and signal
processing, and `normalcdf` is built on it. `erfc(x)` is its complement,
1 - erf(x), computed directly so a far-tail value keeps its digits rather than
rounding to 0.

```solve
erf(0.5) // 0.52
erf(1) // 0.84
erfc(3) // 2.21e-5
```

The **gamma function** `gamma(x)` extends the factorial to numbers that are not
whole: for a whole number n, gamma(n) is (n - 1)!, so `gamma(5)` is 4! = 24.
Between the whole numbers it follows a smooth curve, and `gamma(0.5)` is √π.
`lgamma(x)` is the natural logarithm of gamma, for any positive x. Past about
171.6 gamma itself is too large for any number to hold, and its logarithm is the
form that still answers.

```solve
gamma(5) // 24
gamma(0.5) // 1.77
gamma(4.5) // 11.63
lgamma(200) // 857.93
```

`fact` and `factorial` remain the functions for a whole number's factorial, and
they stay exact past the point where a decimal result would round (see
[big integers](/syntax/big-integers/)); `gamma` answers in ordinary decimals.

## What is refused, and why

Every function checks each argument against its distribution's rules and refuses
one outside them by name, rather than returning the number a formula would still
produce:

```solve-doc
normalcdf(110, 100) // ERROR: normalcdf takes 1 or 3 arguments, but was given 2, as in normalcdf(1.96) or normalcdf(110, 100, 15)
normalcdf(110, 100, 0) // ERROR: normalcdf: a standard deviation must be greater than zero, but was 0
normalinv(1) // ERROR: normalinv: the probability must be greater than 0 and less than 1, but was 1
binompdf(10, 0.5, 11) // ERROR: binompdf: the number of successes cannot be more than the number of trials (10), but was 11
binompdf(10, 0.5, 2.5) // ERROR: binompdf: the number of successes must be a whole number, but was 2.5
poissonpdf(0, 3) // ERROR: poissonpdf: the average number of events must be a finite number greater than zero, but was 0
tcdf(-1, 2, 10) // ERROR: tcdf takes 2 arguments, but was given 3, as in tcdf(2.23, 10)
gamma(-2) // ERROR: gamma is undefined at zero and the negative whole numbers, but was given -2
gamma(200) // ERROR: gamma(200) is too large to represent (gamma is finite up to about 171.6), but lgamma(200) gives its natural logarithm
```

- **Probabilities** are from 0 to 1, as a decimal or a percentage. The inverses
  take them strictly between 0 and 1, since exactly 0 or 1 lies infinitely far
  out and has no value to give.
- **Argument counts** are fixed. The normal functions take one argument or three,
  never two, since a mean with no standard deviation has no scale to measure
  against. A graphing calculator's `normalcdf(lower, upper, mean, sd)` and
  `tcdf(lower, upper, df)` are not forms here; subtract two calls instead.
- **Arguments are plain numbers**, not quantities with units.
- **Standard deviations, averages and degrees of freedom** are greater than zero.
- **The names are reserved as calls.** `gamma(`, `erf(`, `tcdf(` and the rest
  always call these functions, so none of them can also be the name of a
  function you define. `gamma` on its own, without brackets, is still free as a
  variable name.

Results are accurate to at least ten significant figures, and far tails keep
theirs: `normalcdf(-10)` is 7.62e-24, where a formula accurate only to a fixed
number of decimal places would answer 0. The boundary is size. Past about a
hundred billion tries the binomial's cumulative answers keep fewer digits (about
seven at a thousand trillion), and past an average of about twenty billion a
Poisson cumulative answer can be refused as not settling on an accurate value,
rather than approximated.

```solve
normalcdf(-10) // 7.62e-24
normalcdf(-5) // 2.87e-7
```
