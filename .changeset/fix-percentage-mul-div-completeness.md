---
"solve-engine": patch
---

Percentage arithmetic keeps money exact and uncertainty intact across `*` and `/` too, not only `+` and `-`.

Two gaps remained after the percentage-on-money and percentage-on-uncertainty fixes:

```
15% of $0.10        was $0.01, now $0.02   (a percentage times money was not exact)
$0.10 * 15%         was $0.01, now $0.02
(100 +/- 5) / 10%   was 1000,  now 1000 ± 50   (division dropped the tolerance)
```

`15% of $0.10` is `$0.015`, which the half-cent rule rounds to `$0.02` — the same answer `$0.10 + 15%` and the exact multiply `$0.10 * 0.15` already give. And `X / 10%` is `X / 0.1`, a scalar multiply, so an uncertain `X` keeps its relative spread. Both now go through the same base-ten money scaling and the same percentage-uncertainty handling the `+`/`-` and `*` paths use (`of` compiles to a multiply, so both spellings are covered), making the guarantee that percentage arithmetic preserves money exactness and uncertainty true across all four operators.
