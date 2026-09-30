---
title: "Investments"
description: What a sum grows to, what a future sum is worth today, and the return on an investment.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

An investment is money put away now to have more of it later. Three questions
come up about one: what a sum grows to over some years at a rate of interest,
what a sum promised in the future is worth today, and how much an investment
returned for what it cost. Each has a line written the way it is said.

## What a sum grows to

Compound growth is interest that earns interest of its own: at 7% a year, $1,000
becomes $1,070 after one year, and the second year's 7% is taken on $1,070
rather than on the original $1,000. Write the sum, `after` and the term, then
`at` and the yearly rate. The answer is the whole balance at the end, the sum and
its growth together.

```solve
$1,000 after 3 years at 7% // $1,225.04
£1,000 after 3 years at 7% // £1,225.04
1000 after 3 years at 7% // 1,225.04
```

The term carries its unit, so a term in months needs no converting by hand, and
a sum held in a variable grows the same way:

```solve-doc
$1,000 after 18 months at 7% // $1,106.82
:start = $1,000
start after 10 years at 5% // $1,628.89
```

A negative rate shrinks the sum instead, which is how a loss or a steady fall in
value is worked out. A term that is not a length of time is refused rather than
read as a number of years:

```solve
$1,000 after 3 years at -7% // $804.36
$1,000 after 3 kg at 7% // a term is a length of time, and "kg" is not: write it as days, months or years
```

`compound interest on $1,000 over 3 years at 7%` asks the same question in the
phrasing of the [interest](/syntax/interest-and-inflation/) page, and gives the
same balance.

## How often it compounds

Compounding is how often the interest earned so far is added to the sum, so that
it starts earning interest too. The more often that happens, the more a year's
rate grows the sum. Written with `after`, the growth compounds once a year. To
name another interval, write `for` and the term instead, and a `compounding`
tail (or `compounded`, the commoner English):

```solve
$1,000 for 3 years at 7% // $1,225.04
$1,000 for 3 years at 7% compounding quarterly // $1,231.44
$1,000 for 3 years at 7% compounding monthly // $1,232.93
$1,000 for 3 years at 7% compounded monthly // $1,232.93
$1,000 for 3 years at 7% compounding daily // $1,233.65
```

The intervals read are `annually` (or `yearly`), `semi-annually` (or
`semiannually` and `half-yearly`), `quarterly`, `monthly`, `fortnightly`,
`weekly` and `daily`. An interval not on that list is refused, naming the ones
that are:

```solve-doc
$1,000 for 3 years at 7% compounding biannually // ERROR: compounding biannually: expected one of annually, yearly, semi-annually, semiannually, half-yearly, quarterly, monthly, fortnightly, weekly, daily
```

`biannually` is left out on purpose, since some readers take it to mean every
two years and others twice a year. Continuous compounding is not read either.

## What a future sum is worth today

Present value runs compound growth backwards: it is the sum that, put away today
at the rate, grows to the amount named by the end of the term. It is how two
offers paid at different times are compared, since $1,000 now is worth more than
$1,000 in five years. Write `present value of`, the future amount, the term after
`after` or `over`, and the rate.

```solve
present value of $1,225.04 after 3 years at 7% // $1,000.00
present value of $10,000 over 5 years at 6% // $7,472.58
present value of 10000 after 5 years at 6% // 7,472.58
```

The first line undoes the first example on this page: $1,000 grows to $1,225.04
in three years at 7%, so $1,225.04 in three years is worth $1,000 today.

## The return on an investment

The return on investment is the profit an investment made, measured against what
it cost: the amount returned less the amount invested, divided by the amount
invested. Write the amount `invested` and the amount `returned`. The answer is a
percentage, as the other return forms are, so `$500 invested $1,500 returned` is
200%: a profit of $1,000 on $500, twice the cost, not the three times the money
that came back.

```solve
$500 invested $1,500 returned // 200.00%
$1,000 invested $1,500 returned // 50.00%
$1,000 invested $1,000 returned // 0.00%
$1,000 invested $500 returned // -50.00%
```

A return of 0 is breaking even, and a negative one a loss. Nothing invested has
no return to measure, so it is refused:

```solve
$0 invested $100 returned // roi: nothing was invested, so there is no return on it
```

## The return by the year

A total return says nothing about how long it took: doubling your money in two
years is far better than doubling it in twenty. The annual return is the steady
yearly rate that would have turned the amount invested into the amount returned
over the same time, the figure that lets two investments of different lengths be
compared. Write `annual return on`, the two amounts, and the time after `after`
or `in`.

```solve
annual return on $1,000 invested $2,000 returned after 5 years // 14.87%
annual return on $1,000 invested $2,000 returned in 5 years // 14.87%
annual return on $1,000 invested $500 returned after 5 years // -12.94%
```

At 14.87% a year, $1,000 grows to $2,000 in five years, which is the check on the
first line.

## The boundary

- `present value of` takes its term after `after` or `over`, not `in`:
  `present value of $10,000 in 5 years at 6%` is refused as a parse error. Write
  `after 5 years`. The annual-return form does accept `in`.
- `present value of` discounts once a year and takes no `compounding` tail.
- These are the textbook formulas for a single sum. Regular contributions are the
  [savings goals](/syntax/savings-goals/) forms, and a series of payments over
  time is [cash flow](/syntax/cash-flow/). Spreadsheet-style calls such as `fv`
  and `pmt` are not read.
- The answers are an approximation, not a substitute for a real financial
  calculation, which also accounts for fees and tax.
