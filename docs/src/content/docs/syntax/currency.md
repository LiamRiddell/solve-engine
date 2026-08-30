---
title: "Currency"
description: Writing money in symbols or words, and converting between currencies.
---

> **Package:** `CURRENCY_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Money is written the way you would say it: a symbol like `$`, or the currency's
name in words. Amounts in the same currency add and subtract like ordinary
numbers, and converting from one currency to another looks up a live exchange
rate over the network.

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
| `100 USD in GBP on 2024-01-15` | converted at that day's rate |
| `100 USD in GBP on 15 Jan 2024` | the same day, written differently |

An `on <date>` suffix converts at the rate for the day it names rather than
today's, which is what an expense or an invoice reconciled after the fact needs:
a note that was right when written should not drift as the market moves. Both
date spellings above are read by the same parser used everywhere else. Like the
live conversion, the first result is a pending value and the real answer arrives
later.

Historical rates come from a data source you supply, so nothing is assumed and
no live rate is passed off as a historical one. Without a provider a dated
conversion reports that historical rates are not configured rather than falling
back to today's rate.

```ts
import { createCurrencyPackage } from "solve-engine/packages";

const currency = createCurrencyPackage({
  historicalRateProvider: async (from, to, isoDate, signal) => {
    const res = await fetch(`https://example.com/fx/${isoDate}?from=${from}&to=${to}`, { signal });
    return (await res.json()).rate;
  },
});
```

`createCurrencyPackage()` with no argument is the default already in
`BUILTIN_PACKAGES`, so live conversion works out of the box. Build your own with a
`historicalRateProvider` and substitute it into the engine's `packages` array to
answer dated ones. A resolved historical rate never goes stale, since the rate on
a fixed past date does not change. There is no free, keyless historical-FX service
to bake in the way the live rate has one.
