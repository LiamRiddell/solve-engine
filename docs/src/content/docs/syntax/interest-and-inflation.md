---
title: "Interest & inflation"
description: Compound interest, mortgage repayments, and adjusting for inflation.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Interest is what a sum grows by when it is lent or borrowed; inflation is how the
value of money changes over the years. Solve works out the interest on a
principal, the monthly repayment on a loan, and what a past amount is worth in
today's money.

The principal comes first, then the term and the rate, and a mortgage repayment
reads the same way.

```solve
interest on 1000 over 3 years at 5% // 157.63
monthly repayment on 200000 over 25 years at 4% // 1,055.67
```

The term and the rate read in either order, so `at 5% over 3 years` says the same
thing as `over 3 years at 5%`.

## How often interest compounds

Compounding is how often the interest earned so far is added to the sum, so
that it earns interest of its own. The more often that happens, the more a
year's rate grows the sum. Interest compounds once a year unless the line says
otherwise; a `compounding` tail names another interval.

```solve
interest on 1000 over 3 years at 5% compounding annually // 157.63
interest on 1000 over 3 years at 5% compounding quarterly // 160.75
interest on 1000 over 3 years at 5% compounding monthly // 161.47
interest on 1000 over 3 years at 5% compounding daily // 161.82
```

The intervals read are `annually` (or `yearly`), `quarterly`, `monthly`,
`fortnightly`, `weekly` and `daily`, and a day is a 365th of a year. A monthly
repayment is already worked out month by month, with the yearly rate divided by
twelve, the way a lender quotes it, so it takes no `compounding` tail.

The boundary: `semi-annually` is not read today, since the hyphen splits the
word before the interval is looked up, so twice-yearly compounding has no
spelling yet. The tail is written `compounding`: `compounded monthly` is not
read, and the line is refused rather than guessed at.

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

## Inflation

Inflation adjusts an amount into another year's money: `what is $100 from 1990`
asks what $100 in 1990 is worth now. The figures come from a consumer price
index, a published measure of what a fixed basket of goods costs each year,
bundled with the engine so that no line needs the network.

```solve
what is $100 from 1990 // $254.55
```

The index is the United States CPI-U (the consumer price index for all urban
consumers) as annual averages, from 1970 to 2026, with 2025 and 2026 estimated
rather than published. A year outside that range is refused rather than
extrapolated:

```solve
what is $100 from 1960 // Year 1960 is outside the bundled CPI table's range (1970-2026)
```

The boundary: the index is American, so an amount in another currency is
adjusted by US inflation today, which is not what a pound or a euro lost over
the same years:

```solve
what is £100 from 1990 // £254.55
```

The inflation figures are an approximation, not a substitute for a real
financial calculation.
