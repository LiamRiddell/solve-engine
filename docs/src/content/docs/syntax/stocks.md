---
title: Stocks
description: Live and historical share prices, from a fetching function you supply.
---

> **Package:** opt-in. `createStocksPackage({ fetchQuote })` is not among the built-ins `createEngine()` registers; you construct it with your own fetching function and add it to the engine's `packages` (see [choosing packages](/getting-started/installation/)).

The engine holds no market-data key. Prices come from a function you supply, so
the provider, and whatever key it needs, stays yours.

```ts
import { createStocksPackage } from "solve-engine/packages";

const stocks = createStocksPackage({
  fetchQuote: async (ticker, signal) => {
    const res = await fetch(`https://example.com/quote/${ticker}`, { signal });
    return res.json();
  },
});
```

With that in place, a ticker in a `stock(...)` call resolves to its price:

| Expression | Result |
| --- | --- |
| `stock(AAPL)` | the current price |
| `stock(AAPL) * 100` | the price of a hundred shares |
| `stock(AAPL) on April 12, 2005` | the closing price on that day |
| `stock(AAPL) close on 2005-04-12` | the same, with the field named |
| `stock(AAPL) volume on 2005-04-12` | the volume traded that day |

A dated lookup reads from a second function, `fetchHistoricalQuote`, supplied the
same way. The `stock(TICKER)` call is the form the engine recognises; reading a
bare ticker (`AAPL` on its own) is a further opt-in, off by default, so an
ordinary word is never mistaken for a symbol.

Without a `fetchQuote`, `stock(AAPL)` returns a clearly named
`STOCKS_NOT_CONFIGURED` error rather than a fabricated or zero price. A live price
reaches the network, so its first result is a pending value and the real answer
arrives once the request returns. See
[async and live data](/guide/async-and-live-data/) for how a host waits on that.

The results depend on the live provider, so they are shown here rather than
asserted.
