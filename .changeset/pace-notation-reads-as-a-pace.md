---
"solve-engine": patch
---

`4:30/km` is a pace, and reads as one

A two-part clock literal is a time of day everywhere else in the engine, and
reading it as one before a unit produced the epoch divided by that unit.

| expression | before | now |
| --- | --- | --- |
| `4:30/km` | `1,788,665,400,000.00 /km` | `4:30 /km` |
| `10 km at 4:30/km as laptime` | `2484257500:00:00` | `00:45:00` |
| `4m30s/km` | `270.00 seconds/km` | `4:30 /km` |
| `4:30/km in min/mi` | `7.24 min/mi` | `7:15 /mi` |
| `1:30:00/km` | `5,400.00 s/km` | `1:30:00 /km` |

Two things were missing, and the arithmetic was not one of them: `4m30s/km` has
always been 270 seconds per kilometre. What was missing was the spelling a runner
writes, and a display they can read.

**The reading.** A two-part clock literal before a slash and a distance is
minutes and seconds. The distance is what claims the shape, so `12:00/day` is
untouched: hours per day is a time over a time and has no pace in it. A
three-part literal is left alone too, since `1:30:00/km` already arrived at the
right number through the ordinary duration path.

**The display.** A quantity whose unit is a time over a length now shows on a
clock, which is what the `pace` function has always printed. That reaches every
spelling of the same quantity, so `4m30s/km` and a converted `min/mi` read the
same way.

Everything else is exactly as it was: `4:30` on its own is half past four in the
morning, `8:15 + 7:45` is sixteen hours, `9:00 to 17:30` is a shift, and
`90 km/h` is a speed rather than a pace because it is a distance over a time.

The boundary is a pace faster than a minute per unit. A clock shows whole
seconds, and rounding one that fast would change the number, so it keeps its
digits: a swim written `1:30/100m` reads `0.90 seconds/m`, because the
denominator reduces to a single metre.

[Health and fitness](https://liamriddell.github.io/solve-engine/syntax/health/)
gains a proven section beside the `pace` function it now matches.
