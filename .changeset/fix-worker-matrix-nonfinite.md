---
"solve-engine": patch
---

A matrix that contains a non-finite number survives the worker DTO's JSON round-trip.

The scalar guard for `1/0` and `0/0` did not reach a non-finite number sitting inside a matrix cell, so a `[1/0, 2]` result serialised with a raw `Infinity` in its cells. `structuredClone` kept it but `JSON.stringify` turned it into `null`, so the two transport paths disagreed and the value could not be cached and reloaded — the same break the scalar fix removed, one container deeper.

A non-finite matrix cell now carries the same `"Infinity"`/`"-Infinity"`/`"NaN"` string tag the scalar field uses (the cell type already allows strings, alongside the formatted-string form symbolic cells take), so both round-trips agree and a host recovers the value with `Number(cell)`. Finite numeric and boolean cells are unchanged.
