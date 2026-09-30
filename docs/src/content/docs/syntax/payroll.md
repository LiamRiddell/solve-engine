---
title: "Payroll & take-home"
description: "UK take-home pay from a salary, on the HMRC and Scottish income tax bands, with National Insurance, student loans and pensions."
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

The word `salary` may sit before `after tax`, as it is often said, with the same
answer:

```solve
£50,000 salary after tax // £39,519.60
```

`per month after tax` gives the monthly take-home rather than the annual, and
`monthly after tax` is the same question in one word:

```solve
£60,000 salary per month after tax // £3,779.78
£50,000 monthly after tax // £3,293.30
```

The salary has to be in pounds, because these bands are British. A salary in
another currency, or a bare number that names no currency at all, is refused
rather than answered: the bands would produce a confident figure about a
country they say nothing about. What to write instead is on the line below.

## In Scotland

Income tax in Scotland is set by the Scottish Parliament, so a Scottish
taxpayer pays it through six bands rather than three: starter 19%, basic 20%,
intermediate 21%, higher 42%, advanced 45% and top 48%. National Insurance is
the same across the UK. Write `in Scotland` after the salary or the `after tax`
phrase:

```solve
take home on £50,000 in Scotland // £38,023.55
£50,000 after tax in Scotland // £38,023.55
£50,000 per month after tax in Scotland // £3,168.63
£120,000 after tax in Scotland // £71,357.35
```

`in England`, `in Wales` and `in Northern Ireland` name the bands used when no
place is written, so they give the same answer as the plain line.

```solve
£50,000 after tax in Wales // £39,519.60
```

## Student loans

A student loan is repaid through the payroll: a share of pay above a yearly
threshold is taken before the rest reaches your account. Each loan belongs to a
**plan**, set by where and when the course started, and each plan has its own
threshold. Name the plan after `with`:

```solve
£50,000 after tax with plan 2 student loan // £37,664.25
£50,000 after tax with plan 1 student loan // £37,440.60
£50,000 after tax with postgraduate loan // £37,779.60
£50,000 after tax with plan 2 student loan and postgraduate loan // £35,924.25
```

The plans are Plan 1 (£26,900 in 2026/27), Plan 2 (£29,385), Plan 4, the
Scottish plan (£33,795), and Plan 5, first repaid in April 2026 (£25,000), each
at 9% of pay above the threshold; the postgraduate loan is 6% above £21,000, and
is repaid alongside an undergraduate plan. The word `student` may be left out,
as in `with plan 2 loan`. A salary at or below the threshold repays nothing.

A loan with no plan named is refused rather than guessed, since the plans differ
by thousands of pounds of threshold:

```solve
£50,000 after tax with student loan // a student loan needs its plan: write "with plan 1 student loan" (or plan 2, plan 4 or plan 5), or "with postgraduate loan"
```

## Pension contributions

A workplace pension is often paid from salary before income tax is worked out,
so a contribution lowers the tax as well as the take-home. Write the
contribution as a percentage of the salary, after `with`:

```solve
take home on £50,000 with 5% pension // £37,519.60
£50,000 after tax in Scotland with plan 4 student loan and 5% pension // £35,115.10
```

The contribution is taken the way a **net pay arrangement** takes it: out of
gross pay before income tax, so the tax is charged on what is left (and the
personal allowance tapers on that smaller figure too), while National Insurance
and a student loan are still worked out on the full salary. The percentage is of
the whole salary.

Several clauses can follow one another, joined by `and` or each with its own
`with`, in any order. Each kind is written once: one place, one pension (the
total of every contribution), and one undergraduate plan. Two undergraduate
plans together share a single threshold under rules this does not model, so that
line is refused and names the plan to write:

```solve
£50,000 after tax with plan 1 student loan and plan 2 student loan // Plan 1 and Plan 2 together share one threshold, which is not covered: name the plan with the lower threshold
```

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
Insurance at 8% between £12,570 and £50,270, then 2% above. The Scottish bands
for the same year run from £12,571 (starter), £16,538 (basic), £29,527
(intermediate), £43,663 (higher) and £75,001 (advanced), with the top rate above
£125,140. The student loan thresholds are the Student Loans Company's for the
same year.

A tax year has to be chosen, because take-home depends on one. Solve uses the
latest year it ships figures for, and that is a fixed table rather than a year
read off today's date: a new tax year the package has no figures for would
otherwise be answered with the previous year's, silently. The England, Wales and
Northern Ireland figures above are unchanged across 2024/25, 2025/26 and
2026/27, so a salary answers the same in all three there; Scotland's lower bands
and the student loan thresholds move each year, and the package carries a table
for each year beside its neighbours.

The boundary: the figures cover an employee on the **standard tax code**. A
different code, and self-employment (where National Insurance is charged
differently), are not covered, and neither are pensions taken by relief at
source or by salary sacrifice, which change the answer in other ways (a salary
sacrifice lowers National Insurance too). A rate that is not shipped is not
assumed: that is the same boundary the [tax](/syntax/tax/) rule draws, and the
same one the pound requirement above draws. `after 20% tax` is the form for
every case the tables do not describe, and it takes no place or clause, since
its rate is already stated. Any set of income tax bands can also be written as a
table and applied with [banded rates](/syntax/banded-rates/).
