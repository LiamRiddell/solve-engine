---
"solve-engine": patch
---

Tax on money rounds the half-cent the way a till does.

`tax on $0.10 at 15%` is fifteen percent of ten cents, exactly $0.015, and the money rules round a half-cent away from zero. It answered `$0.01`: the tax builtin multiplied `amount * rate` as a plain double (`0.10 * 0.15 = 0.0149999...`) with no exact-decimal sidecar, so the formatter rounded the drifted value down. The mathematically identical `$0.10 * 0.15` was already exact, which made the two disagree.

```
tax on $0.10 at 15%     was $0.01, now $0.02
tax on $10.10 at 15%    was $1.51, now $1.52
```

Tax on money now runs through the same base-ten scaling the `$X + p%` percentage already uses, so it is exact wherever the amount is. `taxAdd`, the tax-inclusive total, shares the mechanism and is fixed with it. A tax on a bare number, or on a non-currency unit, is unchanged.
