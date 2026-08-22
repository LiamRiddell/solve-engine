---
"solve-engine": patch
---

Percentage arithmetic stays exact and keeps uncertainty in two more spots: a chained percentage of money, and a percentage divided by an uncertain number.

```
50% of 1% of $3      was $0.01,  now $0.02
10% / (2 +/- 0.1)    was 0.05,   now 0.05 ± 0.0025
```

`50% of 1% of $3` reduces `50% of 1%` to a bare `0.005` before it multiplies the money, and the money multiply only stayed exact when an operand was literally a percentage — so the chained form drifted a cent while `$3 * 0.005` and `50% of (1% of $3)` did not, making the answer depend on grouping. Money times any scalar (a percentage, or a plain or computed number) now goes through the exact base-ten path, while a rational scalar like `$3 * 2/7` still keeps its exact fraction.

`10% / (2 +/- 0.1)` is `0.1 / 2`, a plain number, so the divisor's spread carries through; the uncertainty handling was one-directional and dropped it. It now handles a percentage over an uncertain number as well as an uncertain number over a percentage, guarding a zero divisor either way.
