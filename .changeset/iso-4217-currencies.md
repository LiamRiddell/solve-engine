---
"solve-engine": patch
---

`$100 in UAH` returned an unconverted hundred dollars.

Not an error and not a conversion: the original amount, as though the rate were 1. The cause was a hand-written allowlist of forty-six currency codes in `CurrencyExchange.isCurrency()`, so a code missing from it silently did nothing. Roughly 130 active ISO 4217 codes were affected, including UAH, RON, BGN, ISK, TWD, GEL, AZN, UZS, KZT and RSD.

Recognition now comes from the ISO 4217 active set rather than from whichever codes happened to get added, and a test asserts every one of them is recognised. Recognising a code is not the same as having a rate for it; that stays a separate question answered by the exchange provider, and conflating the two is what produced the silent failure.

Deliberately still not currencies: `XXX` (the code meaning "no currency"), `XTS` (reserved for testing), the precious metals `XAU`/`XAG`/`XPT`/`XPD`, `XDR`, and withdrawn codes like `DEM`. Cryptocurrencies are recognised as before, separately, since they are not ISO 4217.

**The silent failure itself is not fixed.** `$100 in ZZZ` still returns an unconverted hundred dollars rather than saying it cannot convert. Widening the table removed the common case, not the failure mode. That is asserted as a known gap and tracked in `docs-internal/PARITY_BACKLOG.md`.
