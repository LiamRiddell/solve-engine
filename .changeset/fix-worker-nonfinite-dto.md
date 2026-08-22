---
"solve-engine": patch
---

Fix a non-finite worker result breaking the DTO's JSON round-trip.

A value whose numeric reading is non-finite (`1/0` -> Infinity, `0/0` -> NaN, an overflow) put `Infinity`/`NaN` in the serialized `number` field. That survives `structuredClone` (postMessage) but `JSON.stringify` turns it into `null`, so a host that cached and reloaded the result got a different value, breaking the round-trip the worker DTO guarantees.

`SerializedValue.number` is now always finite (0 when the reading is non-finite), and a new optional `nonFinite` field (`"Infinity"` / `"-Infinity"` / `"NaN"`) names the real value, so both `structuredClone` and `JSON` agree. Read `nonFinite ? Number(nonFinite) : number` to recover the reading.
