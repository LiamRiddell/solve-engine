---
"solve-engine": patch
---

The month-name lookups are `Map`s built once, so the rule tried at every token of a line reads no global and the normaliser runs at its former speed again.

`datetime:month-name-date` has no leading shape, so the normaliser tries it at every token, prose included. When it gained an own-key guard (so that `5 constructor` stopped reading as a date), it read the guard through `Object.prototype.hasOwnProperty.call`, which reads the global `Object` on every call. Inside a `vm` context, the harness the benchmarks run in, that read costs hundreds of nanoseconds, and the benchmark gate confirmed the normaliser suite at 1.35 times its merge base. Both month tables, this rule's and the stocks date phrase's, are now `Map`s, which hold only their own keys and read no global.

| a 200-word prose line, normalised, fastest of seven | before | now |
| --- | --- | --- |
| merge base | 87 µs | |
| this branch before the fix | 148 to 154 µs | 77 to 91 µs |

The boundary: what the lookups read is unchanged, and a prototype word still names no month. The one other rise in the suite, `120 km/h to m/s`, is the rate-target rule #834 added, which does real work on that line, and is left.

## Verification

`__tests__/hardening/MonthLookupReadsNoGlobal.spec.ts` (5 tests) checks that neither lookup reads `hasOwnProperty` or `Object` (both source checks fail on the previous lookups), that a month name reads as a date in any case, and that no word in `PROTOTYPE_WORDS` reads as a month. The found-bugs prototype-month spec and the stocks and datetime package suites pass, and `typecheck`, `typecheck:tests` and `lint:comments` are clean.
