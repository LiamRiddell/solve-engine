---
title: "Crypto"
description: Live crypto prices, from a data source you supply.
---

> **Package:** `createCryptoPackage({ fetchPrice })`. Opt-in, and not in the default engine: there is no free, keyless crypto price API to bundle, so you register it with your own fetch (see [choosing packages](/getting-started/installation/)).

`crypto("BTC")` looks up the current price of a coin. Like stocks, and for the
same reason, the package is opt-in: there is no free crypto price API to ship, so
you supply a `fetchPrice` backed by whichever provider and key you have.

```ts
import { ExpressionEngine } from "solve-engine";
import { BUILTIN_PACKAGES, createCryptoPackage } from "solve-engine/packages";

const crypto = createCryptoPackage({
  fetchPrice: async (coin, signal) => {
    const res = await fetch(`https://example.com/price/${coin}`, { signal });
    return { price: (await res.json()).usd, currency: "USD" };
  },
});

const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, crypto] });
```

With that in place, a coin symbol resolves to its price, returned as ordinary
money so the rest of the language does the arithmetic:

| Expression | Result |
| --- | --- |
| `crypto("BTC")` | the current price of one coin |
| `0.5 * crypto("BTC")` | the value of half a coin |
| `crypto("ETH") in GBP` | the price converted to pounds |

Because the price comes back as money, `0.5 * crypto("BTC")` is the "half a
Bitcoin in dollars" a reader wants, and `in GBP` converts through the currency
package. The currency the answer is quoted in is whatever the provider returns,
US dollars above.

Without a `fetchPrice`, `crypto("BTC")` returns a clearly named
`CRYPTO_NOT_CONFIGURED` error rather than a faked or zero price: a number the
caller did not provide is never guessed.
