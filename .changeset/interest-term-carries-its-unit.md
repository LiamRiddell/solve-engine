---
"solve-engine": patch
---

An interest term carries its unit, so 45 days is no longer charged as 45 years.

The term in a finance form was read as its bare magnitude and the unit thrown away, so every unit meant years.

| | before | now |
| --- | --- | --- |
| `interest on £2,400 over 45 days at 8%` | `£74,209.08` | `£22.88` |
| `interest on £2,400 over 1 month at 8%` | `£192.00` | `£15.44` |
| `interest on £2,400 over 18 months at 8%` | `£7,190.45` | `£293.69` |
| `interest on £2,400 over 1 year at 8%` | `£192.00` | `£192.00` |
| `interest on £2,400 over 3 years at 8%` | `£623.31` | `£623.31` |

`over 1 month` and `over 1 year` answering the same figure was the tell. Nothing that names its term in years changes, which is every documented form and every function-call spelling, and a bare number is still years.

Two conventions come with it, both stated on the page because both are conventions rather than calendar arithmetic. **A month is a twelfth of a year**, so 18 months is a year and a half and `monthly repayment on £200,000 over 300 months at 4.5%` is `£1,111.66`, exactly what the same mortgage over 25 years answers. That is the financial reading and it deliberately differs from the engine's general one, where a month is thirty days and `18 months in years` answers `1.48`: a 300-month mortgage under a thirty-day month would be four months short. **Everything else converts against a 365-day year**, so a 45-day term is the same in February as in March.

A term that is not a length of time is now refused by measure rather than read as a number of years:

```
interest on £2,400 over 5 kg at 8%    a term is a length of time, and "kg" is not: write it as days, months or years
```

The reason this survived the build-time example gate is that no page showed a term shorter than a year. The page now does.
