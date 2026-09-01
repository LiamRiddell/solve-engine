---
"solve-engine": minor
---

A distance or a data size *at* a rate is now a duration.

```
250 miles at 60 mph    4.17 h
4 GB at 50 Mbps        10.67 min
```

`at` a speed answers a drive time; `at` a bandwidth answers a transfer time. New
bandwidth units back the second one: `Mbps`, `Gbps`, `kbps`, and the byte forms
`MBps`, `GBps` (the bit/byte distinction riding the unit's case, as it does for
data sizes). The answer comes back in the largest sensible time unit; convert the
whole thing for another, `(250 miles at 60 mph) in minutes`.

The money `at`-rate is untouched: `$500 at $20/hour` is still `25 hours`. The new
behaviour applies only when the quantity is a distance or a data size that
matches the rate; anything else is reported as an error, not a wrong number.
