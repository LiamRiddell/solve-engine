---
"solve-engine": patch
---

A data rate converts in both directions

A data-rate unit (`Mbps`, `MBps`, `kB/s`, and the like) could be the source of a
conversion but not its target, so one direction worked and its inverse was
refused:

| expression | before | now |
| --- | --- | --- |
| `0.5 MBps in kB/s` | `500 kB/s` | `500 kB/s` |
| `500 kB/s in MBps` | `INCOMPATIBLE_UNITS` | `0.5 MBps` |

`convertRate` expands a data-rate alias to bits per second when it is the source,
but its target branch accepted only a speed alias and returned "no conversion"
for a data-rate target. It now expands a data-rate target the same way, so the
pair lines up both ways and round-trips.

The boundary: this covers the data-rate aliases only. A rate whose two sides
genuinely do not share a measure (a mass per time against a length per time) is
still refused, as before.

## Verification

The rate-conversion unit suite gains the data-rate round-trip, both directions
and there-and-back, and the full suite is green. `npm run verify:ci` passes.
