---
title: "Payroll & take-home"
description: UK take-home pay from a salary, on the HMRC income tax and National Insurance bands.
---

> **Package:** `PAYROLL_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Take-home pay is what actually reaches your account after a salary has had income
tax and National Insurance taken off. Reading a payslip, or working out what a
raise is really worth, means running those bands, which is exactly the fiddly
arithmetic a calculator should do. Write the salary and ask for it after tax.

```solve
£50,000 after tax // £39,519.60
take home on £30,000 // £25,119.60
£120,000 after tax // £76,157.40
```

`per month after tax` gives the monthly take-home rather than the annual:

```solve
£60,000 salary per month after tax // £3,779.78
```

The salary has to be in pounds, because these bands are British. A salary in
another currency, or a bare number that names no currency at all, is refused
rather than answered: the bands would produce a confident figure about a
country they say nothing about. What to write instead is on the line below.

## A rate you state

Everywhere the bands do not reach, state the rate instead. Nothing about this
form is national, so it works on any currency and on a bare number.

```solve
£50,000 after 20% tax // £40,000.00
$50,000 after 20% tax // $40,000.00
50000 after 20% tax // 40,000
```

It is the same take-home question with the arithmetic stated rather than looked
up, which is what anyone outside the UK needs, and what anyone on a flat rate,
a contractor rate or a rate they are modelling needs too.

## An hourly rate

`hourly for` is a plainer sum: the gross salary as an hourly rate, on a full-time
year of 1,920 hours (a 40-hour week across 48 weeks), before any tax. No bands
are involved, so it takes any currency.

```solve
hourly for 45000 // 23.44
hourly for $45,000 // $23.44
```

## Which figures these are

The bands are the full HMRC figures for **England, Wales and Northern Ireland**,
tax year **2026/27**: the £12,570 personal allowance, tapered away £1 for every
£2 earned over £100,000; income tax at 20%, 40% and 45%; and employee National
Insurance at 8% between £12,570 and £50,270, then 2% above.

A tax year has to be chosen, because take-home depends on one. Solve uses the
latest year it ships figures for, and that is a fixed table rather than a year
read off today's date: a new tax year the package has no figures for would
otherwise be answered with the previous year's, silently. The employee figures
above are unchanged across 2024/25, 2025/26 and 2026/27, so a salary answers the
same in all three; the package carries a table for each, so the year a future
Budget moves is one table beside its neighbours.

**Scotland sets its own income tax bands and is not covered here.** That is the
same boundary the [tax](/syntax/tax/) rule draws, and the same one the pound
requirement above draws: a rate that is not shipped is not assumed, rather than
quietly giving a Scottish salary an English answer, or a dollar salary a British
one. `after 20% tax` is the form for every case the table does not describe. The
figures cover a straightforward employee on the standard tax code; a different
code, pension contributions, or student loan repayments change the real number.
