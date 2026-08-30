---
title: "Interest & inflation"
description: Compound interest, mortgage repayments, and adjusting for inflation.
---

> **Package:** `FINANCE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Interest is what a sum grows by when it is lent or borrowed; inflation is how the
value of money changes over the years. Solve works out the interest on a
principal, the monthly repayment on a loan, and what a past amount is worth in
today's money.

Interest compounds annually. The principal comes first, then the term and the
rate, and a mortgage repayment reads the same way.

```solve
interest on 1000 over 3 years at 5% // 157.63
monthly repayment on 200000 over 25 years at 4% // 1,055.67
```

The term and the rate read in either order, so `at 5% over 3 years` says the same
thing as `over 3 years at 5%`.

```solve
interest on 1000 at 5% over 3 years // 157.63
monthly repayment on 200000 at 4% over 25 years // 1,055.67
```

Inflation adjusts an amount into another year's money, from a bundled consumer
price index.

```solve
what is $100 from 1990 // $254.55
```

The inflation figures are an approximation, not a substitute for a real
financial calculation.
