---
"solve-engine": minor
---

Durations written as several units, and written back out.

`3 hours 5 minutes 10 seconds` did not parse. The parts sat next to each other as separate quantities and the parser reported an unexpected number, which is why the timespan, clock and several unit examples all failed in the same place. They now sum into one quantity that converts, adds and compares like any other:

```
3 hours 5 minutes 10 seconds in seconds    11,110
5 hours 30 minutes to seconds              19,800
3h 5m 10s in seconds                       11,110
1 kilometre 500 metres in metres           1,500
```

The rule is deliberately narrow, because a run of number-unit pairs is also what ordinary arithmetic produces. Parts must share a measure, must strictly decrease, and must be unsigned, so `3 hours 5 metres`, `5 minutes 3 hours` and `3 hours - 30 minutes` are all left alone.

`as timespan` and `as laptime` are the inverse, and neither existed despite being credited to the time package:

```
5.5 minutes as timespan    5 minutes 30 seconds
72 days as timespan        10 weeks 2 days
5.5 minutes as laptime     00:05:30
```

Laptime hours are not wrapped at 24, since a twenty-six hour measurement is real. A fractional remainder is kept rather than rounded away, and a non-duration says so rather than being treated as seconds.
