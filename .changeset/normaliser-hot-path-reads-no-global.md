---
"solve-engine": patch
---

Five helpers the normaliser runs at most tokens of a line read no global and build nothing they throw away, so the normaliser suite runs within a few per cent of its merge base again on most cases.

The benchmark gate confirmed the normaliser suite at 1.26 times its merge base, every case slower, the lines where no rule fires included. Each cause was a cost paid on every call by a helper tried at many positions. Inside a `vm` context, the harness the benchmarks run in, a read of a global such as `Object` or `Math` costs hundreds of nanoseconds.

- `resolveCurrencyAlias`, which the rate-target rule (#738) reads at every `in` and `to`, and the unit, `in` and currency parselets read while parsing, guarded its four tables with `Object.prototype.hasOwnProperty.call`. The tables are now read through `Map`s built once, which hold only their own keys, so `constructor` is still no alias.
- The IPv6 rule (#748), tried at every word, number and colon, tested each token's text against a pattern, split it to count its colons, and joined the run's text before its two-colon reject. It now counts in place, joins only a run that passes, and turns away a lone colon (`:v42`, which no address opens with) before measuring the run. Every line of the 500-line document opens with one.
- The zone-after-name rule tried at every word looked the next word up in the zone table before checking for the `in` it needs, and the salary flourish lower-cased the next word before checking for the take-home form after it. The cheap test now comes first in both.
- A date literal's local midnight and UTC instant read `Math.trunc` for every year (#823), where only a year from 0 to 99 needs it.

| normaliser case, median of sixteen interleaved runs against the merge base | before | now |
| --- | --- | --- |
| `:v42 = 43` (assignment) | 1.58x | 1.29x |
| `120 km/h to m/s` (unit_conversion) | 1.63x | 1.12x |
| `25/12/2026 until now` (date_literal) | 1.13x | 1.01x |
| a 500-line document | 1.50x | 1.22x |
| a 200-word prose line | 1.37x | 1.19x |
| a line of prose no rule fires on (noop_prose) | 1.47x | 1.25x |
| geometric mean of the ten cases | 1.30x | 1.16x |

The parse path shares the currency lookup, so the parser suite's `100 cm to m` now parses in about a third of its merge base's time and `now + 5 days` in about half, and the pipeline suite's 200-line document runs at 1.05 times its merge base, from 1.32.

The boundary: nothing a line reads is different. Each helper answers what the one it replaced answered, and the spec proves it against the old implementation, kept there as an oracle. What remains of the gap is the cost of the rules themselves: the IPv6 rule is still a candidate at every word, number and colon, and the multi-word name (#743), salary, payroll clause and zone rules at every pair of words, because their shapes admit them there. Narrowing those shapes would make a spelling the shape leaves out unreachable, which is a behaviour change, and is left. Engine construction in the pipeline suite is also slower than its merge base, spread across the packages added since, with no one cost found to remove. Measured through `jest.bench.config.cjs` on a shared four-core container under a load average of 6 to 10 from other work, base, this branch and the branch before the fix interleaved in each round.

## Verification

`__tests__/hardening/NormaliserHotPathReadsNoGlobal.spec.ts` (36 tests) compares each changed helper with the implementation it replaced: `resolveCurrencyAlias` over every key of every table in four cases, empty, spaced, look-alike and markup-shaped text, and every word in `PROTOTYPE_WORDS` (with `Object.prototype` unchanged); `isRunText` over every UTF-16 code unit and the shared corpora; `colonsIn` against splitting; the IPv6 rule at every position of 36 lines and 13 hand-built streams; `zoneAfterNameAt` and `salaryFlourishAt` at every position, prototype words included; `localDate` and `utcMs` over 30 edge years (negative zero, the window's ends, 2^53, the largest and smallest doubles, the infinities and NaN). Source checks fail on each previous implementation, and the lines a reader writes (`fe80::1`, `$20/hour in $/day`, `£50,000 salary after tax`, `t London in Tokyo`, `1 Jan 0001`) answer what they answered before. The normaliser, currency, calendar, IPv6, payroll and zone suites pass.

The fast suite (`npm run test:ci`, run with the worktree path let through its ignore list) ran 26,336 tests in 772 suites: 26,332 passed and 4 were skipped. `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, the proven docs examples and the hardening and integration suites passed.

On top of main, the full suite ran 29,773 tests in 801 suites, all passing but 4 skipped once two package pages and one spec linked main's createQueryResolver section by its heading (in this change), and `npm run test:temporal` passed its 3,509 tests.
