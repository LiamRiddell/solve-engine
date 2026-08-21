---
"solve-engine": minor
---

Currency conversion can now name the day it happened.

`100 USD in GBP` converts at today's rate, which is right for a live figure and wrong for an expense or an invoice reconciled after the fact: a note that was correct when written quietly stops being correct as the market moves. There was no way to pin the rate to a date, and `100 USD in GBP on 2024-01-15` was not recognised.

A conversion may now carry an `on <date>` suffix, in either spelling the date parser already reads:

```
100 USD in GBP on 2024-01-15     the rate on that day
100 USD in GBP on 15 Jan 2024    the same day, written differently
$100 in GBP on 2024-01-15        the symbol form works too
```

Historical rates are a **host-supplied provider**, the same shape as stocks and weather. There is no free, keyless historical-FX endpoint to bake in the way Frankfurter backs the live rate, so a host passes one to `createCurrencyPackage`:

```ts
import { createCurrencyPackage } from "solve-engine/packages";

const currency = createCurrencyPackage({
  historicalRateProvider: async (from, to, isoDate, signal) => {
    const res = await fetch(`https://example.com/fx/${isoDate}?from=${from}&to=${to}`, { signal });
    return (await res.json()).rate;
  },
});
```

Unconfigured, a dated conversion reports `HISTORICAL_RATES_NOT_CONFIGURED` plainly rather than falling back to today's rate. Guessing a number the caller did not provide, and dressing a live rate as a historical one, is the failure mode the engine works hardest to avoid.

A resolved historical rate is cached as **permanently fresh**: the rate on a fixed past date is immutable, so unlike a live rate the query cache never re-fetches it. The live `100 USD in GBP` conversion and existing date parsing are unchanged.
