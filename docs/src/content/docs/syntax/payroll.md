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
50000 after tax // 39,519.60
take home on 30000 // 25,119.60
120000 after tax // 76,157.40
```

The salary keeps its currency, so a `£` figure answers in `£`, and `per month
after tax` gives the monthly take-home rather than the annual:

```solve
£60,000 salary per month after tax // £3779.78
```

`hourly for` is a plainer sum: the gross salary as an hourly rate, on a full-time
year of 1,920 hours (a 40-hour week across 48 weeks), before any tax.

```solve
hourly for 45000 // 23.44
```

## Which figures these are

The bands are the full HMRC figures for **England, Wales and Northern Ireland**,
tax year **2024/25**: the £12,570 personal allowance, tapered away £1 for every
£2 earned over £100,000; income tax at 20%, 40% and 45%; and employee National
Insurance at 8% between £12,570 and £50,270, then 2% above.

**Scotland sets its own income tax bands and is not covered here.** That is the
same boundary the [tax](/syntax/tax/) rule draws: a rate that is not shipped is
not assumed, rather than quietly giving a Scottish salary an English answer. The
figures cover a straightforward employee on the standard tax code; a different
code, pension contributions, or student loan repayments change the real number.
