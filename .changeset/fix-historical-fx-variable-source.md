---
"solve-engine": patch
---

A dated currency conversion works when the amount is a variable, not only a literal.

```
x = 100 USD
x in GBP on 2024-01-15
```

With a `historicalRateProvider` configured, the second line returned an internal `HISTORICAL_RATE_NOT_PREFLIGHTED` error and the provider was never called. The rate is fetched ahead of evaluation by scanning the compiled line for its source currency, and a variable left operand carries no currency literal to find, so nothing was fetched and the conversion had no rate to apply.

The source currency is known at evaluation time regardless — it is the amount's own unit — so the conversion now fetches the rate itself when the pre-scan could not, the same way any live-data lookup resolves: the line reads as pending, the rate arrives, and the line settles on the converted amount. A literal source (`100 USD in GBP on 2024-01-15`) is unchanged, and with no provider the honest `HISTORICAL_RATES_NOT_CONFIGURED` error is reported rather than an internal one.
