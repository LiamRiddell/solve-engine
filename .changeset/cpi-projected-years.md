---
"solve-engine": patch
---

The CPI table's two projected years are now derived from published data.

The table carried a warning that 2025 and 2026 were projections from model knowledge rather than published figures, and nothing checked how far off they were. Measured against the IMF monthly CPI series for the USA, chaining annual mean year-over-year rates forward from the published 2024 figure:

```
year   table    from IMF   difference
2021   271.0    270.9      -0.02%
2022   292.7    292.6      -0.02%
2023   304.7    304.7      +0.02%
2024   313.7    313.7      +0.01%
2025   320.6    322.2      +0.49%   <- projection
2026   327.4    332.7      +1.63%   <- projection
```

The published years were already right to two hundredths of a percent. Only the two projections drifted, and they are now the IMF-derived figures. Cumulative inflation from 2024 to 2026 was understated as 4.37% where the series shows 6.05%.

`CpiTableAccuracy.spec.ts` pins this against fixed numbers rather than a live fetch, because a test that calls a network service fails when the service is down, and the job here is to catch the table being edited wrongly.
