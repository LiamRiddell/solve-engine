---
"solve-engine": minor
---

A duration written without spaces, the way a stopwatch prints one.

| before | now |
| --- | --- |
| `2h30m` was `Undefined variable: h30m` | `150 minutes` |
| `45m30s` was `Undefined variable: m30s` | `2,730 seconds` |
| `1d6h` was `Undefined variable: d6h` | `30 hours` |
| `1h30m15s` was `Undefined variable: h30m15s` | `5,415 seconds` |

`2h 30m` already read as 150 minutes. The same duration typed without the space did not, because the lexer leaves `h30m` as one identifier and the line became two hours times a variable nobody declared. Both spellings now read the same, which matters because a stopwatch, a video player and most timers print the compact one, and that is the spelling people paste in. It is an ordinary duration once read, so `1h30m in minutes` is `90 minutes`.

The boundary is `m`. On its own it is metres, and `90m` still is: it reads as minutes only beside a larger time unit, which is the only place this looks at it. That is what makes `45m30s` forty-five minutes and thirty seconds rather than forty-five metres.

The parts must run from the larger unit to the smaller, which is what a duration written this way means. Anything that does not descend is not one and keeps whatever meaning it had: `2m30h`, `1m2m` and `100m50cm` are all still undefined variables, and `2x3` is still a multiplication.
