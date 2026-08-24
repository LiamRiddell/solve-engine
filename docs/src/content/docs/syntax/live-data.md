---
title: Live data
description: Weather, stocks and knowledge lookups, and how configuration works.
---

> **Packages:** `WEATHER_PACKAGE`, `CURRENCY_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register them explicitly (see [choosing packages](/getting-started/installation/)).

Three packages reach outside the process. They differ from the rest of the
engine in one important way: the first result is a pending value, and the real
answer arrives later.

## Weather

Built in and enabled by default, because the underlying service needs no key.

| Expression | Result |
| --- | --- |
| `weather in Paris` | a description and temperature |
| `temperature in Tokyo` | the current temperature |
| `high in Berlin` | the daily maximum |

## Stocks

Opt-in. You supply the fetching function, so the engine never holds a key.

```ts
import { createStocksPackage } from "solve-engine/packages";

const stocks = createStocksPackage({
  fetchQuote: async (ticker, signal) => {
    const res = await fetch(`https://example.com/quote/${ticker}`, { signal });
    return res.json();
  },
});
```

Without that function, `stock(AAPL)` returns a clearly named configuration error
rather than a fabricated price.

## Knowledge

Also opt-in, and also supplied as a function.

| Expression | Result |
| --- | --- |
| `search: distance to the moon` | whatever your provider answers |
| `distance to the moon = ?` | the same, in a different phrasing |

## Historical currency rates

Live currency conversion is built in and needs no key. Converting at the rate
for a past day, `100 USD in GBP on 2024-01-15`, needs a source of historical
rates, which you supply. There is no free, keyless historical-FX service to bake
in the way the live rate has one.

```ts
import { createCurrencyPackage } from "solve-engine/packages";

const currency = createCurrencyPackage({
  historicalRateProvider: async (from, to, isoDate, signal) => {
    const res = await fetch(`https://example.com/fx/${isoDate}?from=${from}&to=${to}`, { signal });
    return (await res.json()).rate;
  },
});
```

`createCurrencyPackage()` with no argument is the default, so the currency
package already in `BUILTIN_PACKAGES` still converts live. To answer dated
conversions, build your own with a provider and substitute it into the engine's
`packages` array. Without one, `100 USD in GBP on 2024-01-15` reports that
historical rates are not configured rather than quietly using today's rate. A
resolved historical rate never goes stale, since the rate on a fixed past date
does not change.
