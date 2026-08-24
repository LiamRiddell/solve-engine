---
"solve-engine": minor
---

Savings goals: how long to save, and how much a month.

The saving maths already ran forwards. It now runs backwards too, answering the two questions a savings note actually asks.

```
how long to save $10,000 at $500 monthly       20 months
how much per month to save $12,000 in 2 years  $500.00
```

The interest-free forms are exact division. Add `at <rate>` and the money earns interest on the way (compounded monthly), so the goal arrives sooner or the monthly amount is smaller.

```
how long to save $10,000 at $500 monthly at 12%      19 months
how much per month to save $12,000 in 2 years at 6%  $471.85
```

The duration answers in the contribution's own unit (`weekly` reads in weeks), and the count rounds up, because a part period has not yet reached the goal. The per-month form takes a duration in months or years, `reach` reads the same as `save`, and a bare-number target answers a bare number. The phrases fuse whole, so `save`, `reach` and `how` stay ordinary variable names.

## Verification

- A regression spec covers both directions, the interest-free and annuity cases (hand-derived and cited), the period unit, the round-up, the bare-number target, the unknown-period and unsupported-duration errors, and the untouched variable names.
- 7,784 tests across 343 suites, no failures. `npm run verify` green.
