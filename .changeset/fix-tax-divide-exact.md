---
"solve-engine": patch
---

`tax off` and `tax in` on money round the half-cent like a till, matching `tax on`.

The exact-money rounding reached the multiply tax forms but not the divide forms, so extracting or removing tax drifted a cent while adding it did not:

```
tax off $0.09 at 20%   was $0.07, now $0.08   (true net $0.075)
tax in  $0.09 at 20%   was $0.01, now $0.02   (true $0.015)
```

The same $0.075 reached through `tax on` already displayed $0.08, so the engine showed two different cents for one amount depending on the operation, and `tax off` plus `tax in` no longer summed back to the gross. Both divide forms now go through exact decimal division — exact where the quotient terminates (the cases that can land on a half-cent, at 20%/25%/50%), and rounded far below the cent where it does not, so the displayed cent is right either way. A tax on a bare number or a non-currency unit is unchanged.
