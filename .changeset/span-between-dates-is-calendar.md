---
"solve-engine": patch
---

The span between two dates is counted in calendar days, so it no longer depends on where the reader is.

`<unit> between <a> and <b>` measured the raw millisecond gap and divided it by a fixed 86,400,000. A daylight-saving transition between the two dates therefore leaked an hour into the answer, and its sign followed the hemisphere.

| expression | before, London | before, Auckland | now, everywhere |
| --- | --- | --- | --- |
| `days between 01/01/2024 and 01/06/2024` | 151.96 days | 152.04 days | 152 days |
| `days between 01/03/2024 and 01/04/2024` | 30.96 days | 31 days | 31 days |
| `weeks between 01/01/2024 and 01/06/2024` | 21.71 weeks | 21.72 weeks | 21.71 weeks |

The hour is real, but it is not what the question asks: two calendar days apart is two days wherever you read it. This was found by the differential suite that runs the date behaviour under three time zones, where the documented `weeks between` example failed in Auckland alone.

The boundary is a time of day. Either endpoint carrying one makes the span elapsed time again, because `hours between 9am and 5pm` is a duration and a transition genuinely belongs in it. A span with no transition in it is unchanged, and `between` still has no direction, so the endpoints may be written either way round.
