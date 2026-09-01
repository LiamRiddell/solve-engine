---
"solve-engine": minor
---

Work out UK take-home pay from a salary.

`<salary> after tax` (and `take home on <salary>`) subtracts income tax and
National Insurance:

```
50000 after tax     39,519.60
120000 after tax    76,157.40
```

`per month after tax` gives the monthly figure, and `hourly for <salary>` is the
gross as an hourly rate. A salary keeps its currency, so a `£` figure answers in
`£`.

The figures are the full HMRC bands for England, Wales and Northern Ireland, tax
year 2024/25: the personal-allowance taper over £100,000, the 20/40/45% income
tax bands, and employee NI at 8% then 2%. Scotland sets its own income tax bands
and is not covered, the same boundary the sales-tax rule draws: a rate that is
not shipped is not assumed.
