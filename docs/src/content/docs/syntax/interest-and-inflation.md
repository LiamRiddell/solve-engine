---
title: "Interest & inflation"
description: Compound interest, mortgage repayments, and adjusting for inflation.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Interest is what a sum grows by when it is lent or borrowed; inflation is how the
value of money changes over the years. Solve works out the interest on a
principal, the monthly repayment on a loan, and what a past amount is worth in
today's money.

Interest compounds annually. The principal comes first, then the term and the
rate, and a mortgage repayment reads the same way.

```solve
interest on 1000 over 3 years at 5% // 157.63
monthly repayment on 200000 over 25 years at 4% // 1,055.67
```

The term and the rate read in either order, so `at 5% over 3 years` says the same
thing as `over 3 years at 5%`.

## A term shorter than a year

The term carries its unit, so a short-dated facility or a late invoice is
written the way it is quoted rather than converted by hand first.

```solve
interest on £2,400 over 45 days at 8% // £22.88
interest on £2,400 over 18 months at 8% // £293.69
monthly repayment on £200,000 over 300 months at 4.5% // £1,111.66
```

Two conventions, both worth stating because they are conventions rather than
calendar arithmetic. **A month is a twelfth of a year**, so 18 months is a year
and a half and a 300-month mortgage is a 25-year one, which is what a lender
means by those words. Everywhere else in the engine a month is thirty days, so
`18 months in years` answers `1.48`; a term is the deliberate exception.
**Everything else converts against a 365-day year**, so a 45-day term is the
same whether those days fall in February or March.

A term that is not a length of time is refused rather than read as a number of
years, since a term in kilograms is a mistake and not a quantity.

A bare number is still years, which is what the forms above use.

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
