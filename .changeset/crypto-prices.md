---
"solve-engine": minor
---

Look up crypto prices, `crypto("BTC")`.

The price comes back as ordinary money, so the rest of the language does the
arithmetic: `0.5 * crypto("BTC")` is the value of half a coin, and `... in GBP`
converts it through the currency package. So the "half a Bitcoin in dollars" a
reader wants is `0.5 * crypto("BTC")`, in whatever currency the provider quotes.

Like stocks, and for the same reason, the package is opt-in and not in the
default engine: there is no free, keyless crypto price API to bundle, so a host
supplies `fetchPrice` via `createCryptoPackage({ fetchPrice })`. Without it, a
crypto expression resolves to an honest `CRYPTO_NOT_CONFIGURED` error, never a
faked or zero price.
