---
"solve-engine": patch
---

A number written as a percentage reads no global on its ordinary path, so the vm suite's `percentage` case runs no slower than its merge base again.

The benchmark gate measured that case (`50%` times 200) at 2.1 times its merge base, re-measured at 2.10, 2.14 and 2.11, which pulled the vm suite's geometric mean to 1.20 against a limit of 1.25. Bisecting the merged batches between the merge base and this branch, base and candidate interleaved, put the whole step at found-bugs batch H, which taught a percentage to keep a number's exact decimal past 2^53. The helper that decides whether to keep it, `percentageExact`, read `Number.isFinite`, `Math.abs` and `Number.EPSILON` and raised ten to a power on every percentage, though only a fraction from about 2.25e7 up (a percentage past about 2.25e9%) can need the exact decimal. Inside a `vm` context, the harness the benchmarks run in, a read of a global costs hundreds of nanoseconds.

- `percentageExact` now turns away a fraction below 2e7 with two comparisons before any of that. 2e7 sits under the real threshold, so every fraction it turns away is one the full test turned away too.
- `toPercentage` tests the hundredfold of the fraction for finiteness by subtracting it from itself, which is zero only for a finite number, where it read `Number.isFinite`. The refusal it leads to is unchanged.

| vm case, median of seven interleaved runs against the merge base | before | now |
| --- | --- | --- |
| `percentage` | 2.06x | 0.64x |
| `simple_add` | 0.94x | 0.86x |
| `variable_access` | 0.99x | 0.95x |
| `unit_conversion` | 1.08x | 1.03x |
| `dice_roll` | 1.42x | 1.04x |
| `vector_creation` | 1.29x | 1.31x |
| geometric mean of the six cases | 1.25x | 0.95x |

The boundary: nothing a line reads is different. `50% of 200` is still 100, `9007199254740993.5 as percent` still writes 900,719,925,474,099,350.00% from its exact decimal, and `1e307 as %` is still refused as too large; the spec proves both helpers against the implementations they replaced, kept there as oracles. The `percentage` case now runs faster than its merge base because `toPercentage` there also read `Number.isFinite`. The quantity branch (`100 ppm as %`) still reads it, since a parts-per figure is not on the benchmarked path and is left as it was. `vector_creation` reads about 1.3 times its merge base on this container and about 1.0 on the gate's runner, before and after this change alike; it is not touched here. Measured through `jest.bench.config.cjs` on a shared container under load from other work, in two sessions of seven rounds each, the merge base interleaved with this branch before the fix in one and after it in the other, so the `dice_roll` figure before the fix carries that noise.

## Verification

`__tests__/hardening/PercentageHotPathReadsNoGlobal.spec.ts` (15 tests) compares `percentageExact` and `toPercentage` with the implementations they replaced over 479 doubles (negative zero, the floor and either side of it, a sweep across the real threshold in quarter steps, 2^53 and either side of it, the overflow line, the largest and smallest doubles, the infinities, NaN and a logarithmic sweep), each as a plain number, with a 34-digit exact decimal, with an exact decimal past 2^53 and with a whole and a fractional rational, and over a whole number written with `n`, text, a boolean and a percentage. Source checks fail on each previous implementation, sixteen lines a reader writes answer what they answered before, and the adversarial cases cover prototype words (with `Object.prototype` unchanged), a long sum, deep brackets, a huge power, look-alike digits, markup-shaped text, a value from the line above, a what-if through both passes and every numeric edge. The percentage overflow and parts-per suites pass.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 27,366 tests in 786 suites: 27,362 passed and 4 were skipped. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:changeset`, the proven docs examples and the hardening and integration suites passed.

On top of main, the full suite ran 30,590 tests in 816 suites, all passing but 4 skipped, and `npm run test:temporal` passed its 3,527 tests.
