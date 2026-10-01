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

`interest on` gives the interest alone, what the sum has grown by.
`compound interest on` gives the whole balance at the end, the principal and its
interest together, which is the figure a savings statement shows.

```solve
compound interest on 1000 over 3 years at 5% // 1,157.63
```

A rate of -100% or less has no answer: the sum would fall to nothing, or below
it, so every one of these forms refuses it, and says so with the rate as you
wrote it.

```solve-doc
compound interest on 1000 over 3 years at -150% // ERROR: A rate of -150% cannot be used: it must be more than -100%, since at -100% or less the amount falls to nothing or below.
```

## Repayments and interest by the period

A loan is repaid in equal instalments that cover the interest and a share of the
principal. The monthly figure is the one a lender quotes, and the same loan can
be read by the day, by the year, or over its whole life: `daily`, `monthly`,
`annual` or `total`, before `repayment on` for what is paid, or before
`interest on` for the part of it that is interest. Each is worked out from the
same monthly schedule, so the annual repayment is twelve monthly ones and the
total is every payment added up.

```solve
daily repayment on 200000 over 25 years at 4% // 34.71
monthly repayment on 200000 over 25 years at 4% // 1,055.67
annual repayment on 200000 over 25 years at 4% // 12,668.08
total repayment on 200000 over 25 years at 4% // 316,702.10
daily interest on 200000 over 25 years at 4% // 12.79
monthly interest on 200000 over 25 years at 4% // 389.01
annual interest on 200000 over 25 years at 4% // 4,668.08
total interest on 200000 over 25 years at 4% // 116,702.10
```

A repayment is often just called a payment, and `payment on` reads the same way
as `repayment on` for each of the four periods: `daily payment on`, `monthly
payment on`, `annual payment on` and `total payment on`.

```solve
monthly payment on $200,000 over 25 years at 4% // $1,055.67
total payment on 200000 over 25 years at 4% // 316,702.10
```

Only the three words together are claimed, so a variable named `payment` still
works on its own and beside the phrase:

```solve-doc
payment = monthly payment on 200000 over 25 years at 4% // 1,055.67
payment * 12 // 12,668.08
```

The total interest is what the loan costs: the total repaid less the 200,000
borrowed. The periodic interest figures are that cost spread evenly, an average
over the term, not the interest in any one month (early payments are mostly
interest, late ones mostly principal).

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

The intervals read are `annually` (or `yearly`), `semi-annually` (or
`semiannually` and `half-yearly`), `quarterly`, `monthly`, `fortnightly`,
`weekly` and `daily`, and a day is a 365th of a year. The tail may also be
written `compounded`, the commoner English.

```solve
interest on 1000 over 3 years at 5% compounding semi-annually // 159.69
interest on 1000 over 3 years at 5% compounded monthly // 161.47
```

A monthly
repayment is already worked out month by month, with the yearly rate divided by
twelve, the way a lender quotes it, so it takes no `compounding` tail.

The boundary: `biannually` is not read, since some readers take it to mean
every two years rather than twice a year, and nor is the two-word `twice
yearly`. A line using either is refused rather than guessed at.

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

## The function forms

Each phrase has a function spelling as well, for a line built from other values
or copied from a spreadsheet. The arguments are the principal, the rate and the
term in years, in that order.

- `compoundInterest(principal, rate, years)` is the balance at the end, and
  `interestEarned(principal, rate, years)` the interest alone.
- `compoundInterestRate(principal, balance, years)` finds the yearly rate that
  grows one into the other, and `compoundInterestYears(principal, balance,
  rate)` how many years it takes.
- `monthlyPayment(principal, rate, years)` is a loan's monthly repayment.
  `loanRepayment` and `loanInterest` take a fourth argument, the payments per
  year the answer is given for (12 for monthly, 1 for yearly), and give the
  repayment and the interest in it the way the phrases above do.

```solve
compoundInterest(1000, 5%, 3) // 1,157.63
interestEarned(1000, 5%, 3) // 157.63
compoundInterestRate(1000, 1157.63, 3) // 5.00%
compoundInterestYears(1000, 1157.63, 5%) // 3.00
monthlyPayment(200000, 4%, 25) // 1,055.67
loanRepayment(200000, 4%, 25, 12) // 1,055.67
loanInterest(200000, 4%, 25, 12) // 389.01
```

The spreadsheet functions `pmt`, `fv` and `npv` are not read under those names.
A spreadsheet's `PMT` takes the rate per period, the number of periods and the
principal, in that order, and a call spelled the same way that read its
arguments in another order would give a wrong answer without saying so. Inside
a call, a comma also separates arguments, so write a principal without thousands
separators there (`200000`, not `200,000`). Cash flows have their own phrase,
`npv of` (see [cash flow](/syntax/cash-flow/)).

## The return on an investment

A return is what an investment gained, measured against what went in: $1,000
that became $1,500 made a 50% return. Every way of asking answers a percentage,
so the answers compare and combine with each other. `invested ... returned`
gives the whole gain; `annual return on` and `compoundInterestRate` give the
yearly rate that, compounded, turns the one amount into the other.

```solve
$1,000 invested $1,500 returned // 50.00%
$500 invested $1,500 returned // 200.00%
annual return on $1,000 invested $1,500 returned after 3 years // 14.47%
compoundInterestRate($1,000, $1,500, 3) // 14.47%
```

The whole gain is the profit against the cost, not the money multiple: tripling
your money is a 200% return. For the multiple, divide (`$1,500 / $500` is 3), or
ask for the return `as multiplier`, which is 3x.

The function forms take amounts written the usual way, thousands commas
included: inside the brackets of a call, a comma after an amount with a
currency sign and before exactly three digits groups the thousands (see
[amounts inside a call](/syntax/currency/#amounts-inside-a-call)).

```solve
compoundInterest($1,000, 5%, 3) // $1,157.63
```

## Inflation

Inflation adjusts an amount into another year's money: `what is $100 from 1990`
asks what $100 in 1990 is worth now. The figures come from a consumer price
index, a record of what a typical basket of shopping cost in each year, so the
ratio of two years' figures says how much more money buys the same things. Each
country's index records its own prices, so the amount's currency picks the
index: US dollars read the US index, pounds sterling the UK one and euros the
euro-area one. The indices are bundled with the engine, so no line needs the
network.

```solve
what is $100 from 1990 // $253.39
inflationAdjust($100, 1990, 2020) // $198.02
what is $500 in 1990 worth in 2010 // $834.19
```

The first line runs to the current year, so its answer moves on each January;
the other two name both years.

`what was $500 worth in 1965` runs the other way: it takes $500 of today's money
and says what the same buying power came to in 1965, when prices were lower.
`$100 in 1965 dollars` asks the same question in fewer words, and `£100 in 1990
pounds` and `€100 in 2010 euros` ask it of pounds and euros, each through its
own index (the singular `pound`, `dollar` and `euro` work too).

```solve
what was $500 worth in 1965 // $47.56
$100 in 1965 dollars // $9.51
£100 in 1990 pounds // £30.53
```

The amount can be worked out on the line: `what is $100 * 2 from 1990` adjusts
$200, and `what is $300 + $50 from 2003` adjusts $350, the same as the
bracketed `($300 + $50)`. Everything between `what is` and `from` (or `in`, or
`worth in`) is the amount, so a `+` or `-` there joins two amounts, since the
year can only come after one of those words.

```solve
what is $100 * 2 from 1990 // $506.78
what is $300 + $50 from 2003 // $629.96
what is ($300 + $50) from 2003 // $629.96
what is $300 + $50 in 1990 worth in 2010 // $583.93
```

### Which index answers each currency

Three indices are bundled, one for each currency below, and each covers only
the years its publisher has figures for.

| Currency | Index | Years |
| --- | --- | --- |
| US dollars (`$`, `USD`) | US CPI-U, series CUUR0000SA0 from the Bureau of Labor Statistics | 1913 to 2026 |
| Pounds sterling (`£`, `GBP`) | ONS series CDKO, the long-term indicator of prices of consumer goods and services | 1800 to 2026 |
| Euros (`€`, `EUR`) | Eurostat's HICP (harmonised index of consumer prices) for the euro area | 1999 to 2025 |

Every table is built ahead of time by a script in the repository from the
published series, and its source and the date it was retrieved are written at
the top of the table's file.

**US dollars.** The index is the United States CPI-U (the consumer price index
for all urban consumers, US city average, all items), series CUUR0000SA0 from
the Bureau of Labor Statistics. Each year is the average of its twelve monthly
figures, worked out the way BLS works out its own annual average, and the table
runs from 1913, the first year of the series, to the current year. Two years are
not a full twelve months:

- **2025** has eleven: October 2025 was never collected, during the 2025 lapse
  in US government funding. Its figure is the average of the other eleven, which
  is the 321.943 BLS published.
- **The current year** is partial: it averages the months published so far
  (January to July 2026 in this build), so an answer that reads it moves a
  little each time the table is rebuilt.

**Pounds sterling.** The UK has several price indices (CPI, CPIH and RPI), and
none of them on its own reaches back before the Second World War. The bundled
one is ONS series CDKO, the long-term indicator of prices of consumer
goods and services (January 1974 = 100). CDKO is the ONS's own long-run consumer
price series, which chains RPI-era data before the CPI's start, so a single
series runs from 1800 to now. It is none of CPI, CPIH or RPI on its own, so an
answer here can differ a little from one worked out with any one of them. Each
year is the annual figure ONS publishes, and the current year is partial, the
average of the months published so far (January to July 2026 in this build).

```solve
what is £100 from 1990 // £327.52
what was £500 worth in 1965 // £17.92
inflationAdjust(£100, 1990, 2020) // £232.44
```

**Euros.** The euro-area index is Eurostat's HICP (the harmonised index of
consumer prices, the measure the European Central Bank targets) for the euro
area as its membership changed, taken from the ECB's monthly series
ICP.M.U2.N.000000.4.INX. Each year is the average of its twelve months, which is
how Eurostat works out its own annual average.

```solve
inflationAdjust(€100, 2000, 2020) // €138.15
what is €100 in 1999 worth in 2025 // €172.87
```

The euro has two boundaries of its own. The index starts in 1996, but the euro
began in 1999, so a euro amount from before 1999 would be a sum in francs, marks
or lire converted at a rate fixed afterwards: those years are refused with the
reason. And the series ends with 2025: the ECB discontinued it in February 2026,
when Eurostat changed how the HICP is compiled, and its replacement is a
different series, which is not joined on. So a euro line that runs to the
current year is refused, `€100 in 2010 euros` included, since it starts from
today's money; naming both years, as `inflationAdjust` does, answers.

```solve
what is €100 from 1990 // Year 1990 is before the euro began in 1999, so there is no amount in euros from then to adjust (the euro-area price index itself starts in 1996)
what is €100 from 2000 // Year 2026 is outside the bundled euro-area price index's range (1999-2025): the series it is built from ends with 2025, so name a year up to 2025 to adjust to
€100 in 2010 euros // Year 2026 is outside the bundled euro-area price index's range (1999-2025): the series it is built from ends with 2025, so name a year up to 2025 to adjust to
```

### Years and amounts an index cannot read

A year outside an index is refused rather than extrapolated, since a year before
a series began has no figure, and a year after the latest has a forecast at
best. The refusal names the index and its range:

```solve
what is $100 from 1912 // Year 1912 is outside the bundled CPI table's range (1913-2026)
what is £100 from 1799 // Year 1799 is outside the bundled UK price index's range (1800-2026)
```

An amount in any other currency is refused rather than adjusted by another
country's prices with its own currency sign. So is a quantity that is not money,
and so is a bare number, which names no currency for an index to be chosen by.
An amount converted into a currency first, such as `($100 in GBP)`, is in that
currency, so it reads that currency's index.

```solve
what is ¥100 from 1990 // no price index for JPY is bundled, so there is no record of what it bought in another year: only an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100, can be adjusted
what is 100 from 1990 // a price index measures one currency, and this amount has none: write it with its currency, in US dollars, pounds sterling or euros, such as $100, £100 or €100
```

A word straight after the number stands where a currency would, so `what is 100
apples from 1990` is refused by that word: apples are not money. To adjust a
price held in a name, write the multiplication out, `what is 100 * apples from
1990`, which reads the name's value. `pounds` on its own is the weight, as in `5
kg in pounds`, so an amount of money in pounds is written `£100` or `100 GBP`,
and the refusal says so.

```solve
what is 100 apples from 1990 // a price index adjusts money, and apples is not a currency: give an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100
what is 100 pounds from 1990 // a price index adjusts money, and pounds is a mass: give an amount in US dollars, pounds sterling or euros, such as $100, £100 or €100 (for pounds sterling, write £100 or 100 GBP)
```

`in 1965 dollars` names the currency it answers in, so it takes an amount in
dollars only, and `in 1990 pounds` and `in 1990 euros` likewise take pounds and
euros only: the line asks for one currency, and an amount in another would need
a conversion and an adjustment at once. `what was £100 worth in 1965` reads any
currency's own index.

```solve
£100 in 1990 dollars // in 1990 dollars asks for US dollars, and this amount is in GBP: ask what it was worth in 1990 instead, which reads the UK price index (ONS CDKO)
$100 in 1990 pounds // in 1990 pounds asks for pounds sterling, and this amount is in USD: ask what it was worth in 1990 instead, which reads the US consumer price index (BLS CPI-U)
```

`value of £100 in 2030 assuming 3% inflation` is a different question: it states
the rate rather than reading an index, so it takes any currency.

The figures are the published indices, but an adjustment by one is still an
average over a typical basket of shopping, not what any one price did. For a
contract, a tax figure or a cost-of-living clause, use the series from its
publisher directly: bls.gov/cpi, ons.gov.uk, or Eurostat.
