---
title: Live data
description: Weather, stocks and knowledge lookups, and how configuration works.
---

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
