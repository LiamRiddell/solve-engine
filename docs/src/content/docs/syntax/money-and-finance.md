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

## Exact decimals

Money is exact. A price is a decimal, not a binary fraction, so amounts in the
same currency add, subtract, multiply and divide without the rounding error a
floating-point number carries.

```solve
$0.10 + $0.20 // $0.30
$19.99 * 3 // $59.97
$100 - $99.99 // $0.01
$10 / 3 // $3.33
$0.70 * 1.10 // $0.77
```

A half-cent rounds away from zero, the way a till rounds it, rather than the way
`toFixed` rounds the nearest double sitting just below it.

```solve
$1.005 // $1.01
$2.675 // $2.68
```

Exactness holds wherever a currency is involved, a currency against a plain
number included. A bare decimal on its own is an ordinary floating-point number,
and a conversion between two currencies goes through a live rate, which is not
exact.

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

Interest compounds annually. The principal comes first, then the term, then the
rate, and a mortgage repayment reads the same way.

```solve
interest on 1000 over 3 years at 5% // 157.63
monthly repayment on 200000 over 25 years at 4% // 1,055.67
```

Inflation adjusts an amount into another year's money, from a bundled consumer
price index.

```solve
what is $100 from 1990 // $254.55
```

The inflation figures are an approximation, not a substitute for a real
financial calculation.
