---
"solve-engine": patch
---

A speed in knots multiplied by a time is a distance: `10 knots * 2 hours` answers 20.00 nmi

A knot is one nautical mile an hour. `kn` carried that reading (its rate form, `nmi/h`), so a speed in `kn` times a time cancelled the hours and left nautical miles. The written-out `knot` and `knots` converted and added as speeds, but had no rate form, so multiplying one by a time was refused. They now carry the same `nmi/h` form as `kn`. This was found by an earlier adversarial batch.

| line | before | now |
| --- | --- | --- |
| `10 knots * 2 hours` | speed and duration cannot be multiplied | 20.00 nmi |
| `10 kn * 2 hours` | 20.00 nmi | 20.00 nmi |

The boundary: `kt` is still not a knot, because the table reads it as a kilotonne. The rates-and-speeds page shows the product, proven.

## Verification

`FoundBug_knotsAsSpeed.spec.ts` (14 tests) holds the lines above and `kt` unchanged, the table entries and rate forms, the measure, a knot refused as a length, zero and negative knots, and the adversarial sides: prototype words beside a knot, a thousand-term sum within budget, markup, a speed from the line above with a check and a unit that does not fit through both passes, and every numeric edge. The unit reference was regenerated with `npm run stats:units` after a build.

Gates run: `npm run typecheck`, `typecheck:tests` (at the baseline, which fell by two), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:links` passed; the docs, hardening and integration suites passed (9,242 tests in 98 suites); the fast suite ran 25,718 tests in 764 suites, all passing but 4 skipped once one merged spec that used `0/0` as a NaN was moved to `1/0 - 1/0`. `executeBytecode` stays under its size margin. `npm run verify` and the bundled-consumer contract were not run.

On top of main, the full suite ran 27,327 tests in 778 suites, all passing but 4 skipped once the guide manifest and one zone assertion followed main (both in this change), and `npm run test:temporal` passed its 3,477 tests.
