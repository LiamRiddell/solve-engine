---
title: "Money & finance"
description: Currency, tax, interest and inflation.
---

## Currency

```solve
$100 + $50 // $150.00
10 dollars // $10.00
```

Symbols and words are both recognised. Conversion between currencies reaches the
network and resolves asynchronously. See
[async and live data](/guide/async-and-live-data/).

| Expression | Result |
| --- | --- |
| `10 USD in GBP` | converted at the current rate |
| `100 euros to dollars` | the same, in words |
| `100 USD in GBP on 2024-01-15` | converted at that day's rate |
| `100 USD in GBP on 15 Jan 2024` | the same day, written differently |

An `on <date>` suffix converts at the rate for the day it names rather than
today's, which is what an expense or an invoice reconciled after the fact needs:
a note that was right when written should not drift as the market moves. Both
date spellings above are read by the same parser used everywhere else. Like the
live conversion, the first result is a pending value and the real answer arrives
later.

Historical rates come from a data source you supply, so nothing is assumed and
no live rate is passed off as a historical one. Without a provider a dated
conversion reports that historical rates are not configured rather than falling
back to today's rate. See [live data](/syntax/live-data/) for wiring one up.

## Exact decimals

Money is exact. A price is a decimal, not a binary fraction, so amounts in the
same currency add, subtract, multiply and divide without the rounding error a
floating-point number carries.

```solve
$0.10 + $0.20 // $0.30
$19.99 * 3 // $59.97
$100 - $99.99 // $0.01
$10 / 3 // $3.33
$0.70 * 1.10 // $0.77
```

A half-cent rounds away from zero, the way a till rounds it, rather than the way
`toFixed` rounds the nearest double sitting just below it.

```solve
$1.005 // $1.01
$2.675 // $2.68
$0.10 + 15% // $0.12
```

Exactness holds wherever a currency is involved, a currency against a plain
number included, and that includes adding a percentage: `$0.10 + 15%` is
`$0.115`, which the half-cent rule rounds up. A bare decimal on its own is an ordinary floating-point number,
and a conversion between two currencies goes through a live rate, which is not
exact.

## Tax

```solve
tax on 100 at 20% // 20
100 + 20% // 120
tax off 120 at 20% // 100
tax in 120 at 20% // 20
```

`tax on` gives the tax, not the bill. The bill is `100 + 20%`, which reads as a
twenty percent increase. Going the other way, `tax off` takes a tax-inclusive
total back to the pre-tax amount and `tax in` (also `tax of`, `tax from`) pulls
out the tax already inside it. `vat` is accepted everywhere `tax` is.

On money the tax is exact, rounding the half-cent the same way the rest of the
currency arithmetic does rather than the way a drifted double would, and that
holds whether the tax is added, taken off, or pulled out.

```solve
tax on $0.10 at 15% // $0.02
tax off $0.09 at 20% // $0.08
tax in $0.09 at 20% // $0.02
```

No tax rate is ever assumed. You state it, because the correct rate depends on
where you are and what you are buying.

## Recurring schedules

A series adds itself up. `<amount> <period> for <duration>` gives the total, so
a subscription, a salary or an instalment plan does not have to be worked out
elsewhere and typed back in.

```solve
450 monthly for 18 months // 8,100
12.99 monthly for 2 years // 311.76
2000 every 2 weeks for 6 months // 26,000
```

The period is `daily`, `weekly`, `monthly`, `yearly` (also `annually`), or
`every N days/weeks/months/years`. Money rides along and, where the amount is
exact, so is the total.

```solve
$12.99 monthly for 2 years // $311.76
```

The total is the result. The number of payments is how it is reached, one per
whole period on a scheduling year where a month is one of twelve and a week one
of fifty-two, so `every 2 weeks for 6 months` is thirteen payments over half a
year. A final part-period has not come due, so it is not counted.

```solve
2000 every 2 weeks for 5 weeks // 4,000
```

## Splitting a bill

Splitting a bill is the most common money note there is. `split <amount>
between <N>`, or `<amount> split <N> ways`, answers it in place, as the amount
divided by the people paying it.

```solve
split $120 between 3 // $40.00 each
$120 split 3 ways // $40.00 each
split $100 between 4 people // $25.00 each
```

The amount stays exact, so a tip written as a percentage composes with the split
on one line: `$120 + 18%` is `$141.60`, and split three ways that is `$47.20`
each. A bare number splits to a bare number, so no currency is invented where
none was written.

```solve
$120 + 18% split 3 ways // $47.20 each
10 split 3 ways // 3.33 each
```

The boundary is the odd penny. `split $100 between 3` is not a bare `$33.33
each` that quietly loses a penny: the extra penny is named, and the shares add
back to the total to the cent.

```solve
split $100 between 3 // $33.33 each, with 1 share paying $33.34
```

`split`, `ways` and `people` are ordinary words everywhere else. They are read
as the split grammar only inside the full shape, so a variable named `split`, or
`:split = 5`, is untouched. The count must be a whole number of at least one, and
a literal: a parenthesised or worded count leaves `split` an ordinary word.

## Interest and inflation

Interest compounds annually. The principal comes first, then the term and the
rate, and a mortgage repayment reads the same way.

```solve
interest on 1000 over 3 years at 5% // 157.63
monthly repayment on 200000 over 25 years at 4% // 1,055.67
```

The term and the rate read in either order, so `at 5% over 3 years` says the same
thing as `over 3 years at 5%`.

```solve
interest on 1000 at 5% over 3 years // 157.63
monthly repayment on 200000 at 4% over 25 years // 1,055.67
```

Inflation adjusts an amount into another year's money, from a bundled consumer
price index.

```solve
what is $100 from 1990 // $254.55
```

The inflation figures are an approximation, not a substitute for a real
financial calculation.

## Savings goals

The saving maths runs backwards too. `how long to save <target> at <amount>
<period>` answers the time, and `how much per month to save <target> in
<duration>` answers the contribution.

```solve
how long to save $10,000 at $500 monthly // 20 months
how much per month to save $12,000 in 2 years // $500.00
```

The interest-free forms are exact division. Add `at <rate>` and the money earns
interest on the way, so the goal arrives sooner or the monthly amount is smaller;
the rate compounds monthly.

```solve
how long to save $10,000 at $500 monthly at 12% // 19 months
how much per month to save $12,000 in 2 years at 6% // $471.85
```

The duration answers in the contribution's own unit (`weekly` reads in weeks),
and the count rounds up, because a part period has not yet reached the goal. The
per-month form takes a duration in months or years, and `reach` reads the same
as `save`. A bare-number target answers a bare number.
