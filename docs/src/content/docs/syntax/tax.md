---
title: "Tax"
description: Adding tax, taking it off a total, and pulling it out of one.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Tax questions come in three shapes: how much tax is due on an amount, what the
total is once tax is added, and how much tax is already inside a tax-inclusive
price. Solve has a phrase for each, so you do not have to remember which way to
multiply.

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

On money the tax is exact, rounding the half-cent the same way the rest of the
currency arithmetic does rather than the way a drifted double would, and that
holds whether the tax is added, taken off, or pulled out.

```solve
tax on $0.10 at 15% // $0.02
tax off $0.09 at 20% // $0.08
tax in $0.09 at 20% // $0.02
```

No tax rate is ever assumed. You state it, because the correct rate depends on
where you are and what you are buying.
