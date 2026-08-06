---
title: Money and finance
description: Currency, tax, interest and inflation.
---

## Currency

```solve
$100 + $50 // $150.00
10 dollars // $10.00
```

Symbols and words are both recognised. Conversion between currencies reaches the
network and resolves asynchronously. See
[async and live data](/guide/async-and-live-data/).

| Expression | Result |
| --- | --- |
| `10 USD in GBP` | converted at the current rate |
| `100 euros to dollars` | the same, in words |

## Tax

```solve
tax on 100 at 20% // 20
100 + 20% // 120
tax off 120 at 20% // 100
tax in 120 at 20% // 20
```

`tax on` gives the tax, not the bill. The bill is `100 + 20%`, which reads as a
twenty percent increase. Going the other way, `tax off` takes a tax-inclusive
total back to the pre-tax amount and `tax in` (also `tax of`, `tax from`) pulls
out the tax already inside it. `vat` is accepted everywhere `tax` is.

No tax rate is ever assumed. You state it, because the correct rate depends on
where you are and what you are buying.

## Interest and inflation

| Expression | Result |
| --- | --- |
| `interest on 1000 at 5% over 3 years` | simple interest |
| `monthly repayment on 200000 at 4% over 25 years` | a mortgage payment |
| `what is $100 from 1990` | adjusted using a bundled price index |

The inflation figures come from a bundled consumer price index and are an
approximation, not a substitute for a real financial calculation.
