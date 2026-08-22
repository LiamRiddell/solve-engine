---
"solve-engine": patch
---

Fix percentage arithmetic dropping exactness and uncertainty.

Two related defects in `X ± N%` (and `X * N%` / `N% of X`):

- **Money drifted a cent.** `$0.10 + 15%` answered `$0.11` instead of `$0.12`. The result was a bare double (`0.10 * 1.15 = 0.1149999...`) with no exact-decimal sidecar, so the half-cent rounded down, even though the identical `$0.10 * 1.15` was exact. Percentage scaling of money now goes through the same base-ten path, so `$0.10 + 15%` is `$0.12` and `$4.55 + 10%` is `$5.01`.
- **Uncertainty was silently lost.** `(100 ± 5) + 10%` answered `110` instead of `110 ± 5.5`. A percentage is a scalar multiply, so a carried tolerance now scales by the same factor across `+`, `-`, `*` and `of`.

Non-money units, plain numbers, and percentages without a tolerance are unchanged.
