---
"solve-engine": patch
---

The knot is a speed: `5 mph + 3 knots` adds, and `3 knots in km/h` converts

The unit table knew the knot only by its code, `kn`, so `knots`, the word a sailor or a pilot writes, was no unit, and `5 mph + 3 knots` answered "Undefined variable: knots". `knot` and `knots` are now speeds in the table's ordinary path, one nautical mile (1,852 m) an hour, beside `kn`, with the `nmi/h` rate form `kn` has, so they convert, add to other speeds, and cancel against a time. This was found by an earlier adversarial batch.

| line | before | now |
| --- | --- | --- |
| `5 mph + 3 knots` | Undefined variable: knots | 8.45 mph |
| `3 knots in km/h` | Undefined variable: knots | 5.56 km/h |
| `10 knots * 2 hours` | Undefined variable: knots | 20.00 nmi |

The boundary: `kt` is not a knot, because the table already reads it as a kilotonne, and a mass that silently became a speed would be worse than the spelling left out. The rates-and-speeds page shows the knot, proven, and says why `kt` is not one; the unit reference lists `knots` beside `kn`.

## Verification

`FoundBug_knotsAsSpeed.spec.ts` (14 tests) holds the lines above and `kt` unchanged, the table entries and rate forms, the measure, a knot refused as a length, zero and negative knots, and the adversarial sides: prototype words beside a knot, a thousand-term sum within budget, markup, a speed from the line above with a check and a unit that does not fit through both passes, and every numeric edge. The unit reference was regenerated with `npm run stats:units` after a build.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.
