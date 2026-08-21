---
"solve-engine": minor
---

A recurring schedule adds itself up.

Subscriptions, salaries and instalments are the most common thing anyone adds up in a note, and there was no way to write the series. The total had to be worked out elsewhere and typed back in as a number, which is the part worth checking. `<amount> <period> for <duration>` now answers it:

```
450 monthly for 18 months        was 450 * 18 by hand, now 8,100
12.99 monthly for 2 years        now 311.76
2000 every 2 weeks for 6 months  now 26,000
```

The period is `daily`, `weekly`, `monthly`, `yearly` (also `annually`), or `every N days/weeks/months/years`. Money rides along, and where the per-payment amount is exact so is the total, through the same money-multiply path that makes `£12.99 * 24` exactly `£311.76`:

```
£450 monthly for 18 months   now £8100.00
$12.99 monthly for 2 years   now $311.76
```

The total is the primary result. The number of payments is the secondary detail that produced it (total is the amount times the count), and the count is a whole number: one payment per completed period, on a scheduling year where a month is one of twelve and a week one of fifty-two. That is what makes `every 2 weeks for 6 months` thirteen payments over half a year, rather than the twelve a thirty-day month would give. A final part-period has not come due and is not counted, so `every 2 weeks for 5 weeks` is two payments, not three.

The word `for` is shared with the investment grammar (`$1,000 for 3 years at 7%`) and the rate grammar (`$24 a day for a year`). A schedule is claimed only when a period word sits before `for` and a plain duration follows it, so both of those keep working, and a bare `monthly` or `weekly` is still an ordinary variable name.
