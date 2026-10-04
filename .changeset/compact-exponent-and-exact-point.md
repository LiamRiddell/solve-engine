---
"solve-engine": patch
---

`as compact` no longer writes an exponent and a suffix together (`$1e308/hour` is `$1e+308/hour`, not `$1e+296T/hour`), and the point and the pica are exact

`as compact` divided a figure by the largest suffix it reached and wrote the result, and a figure divided by a trillion can itself need an exponent, so the answer stated its size twice in two notations, and below that it ran to a string of digits before the `T` (`100000000T`). A figure that rounded to a thousand trillion was written `1000T`, past the tier. Past the largest suffix the figure is now written in exponent form with no suffix, still to three significant figures.

| line | before | now |
| --- | --- | --- |
| `$1e308/hour as compact` | $1e+296T/hour | $1e+308/hour |
| `1e20 as compact` | 100000000T | 1e+20 |
| `999.95e12 as compact` | 1000T | 1e+15 |
| `1e12 as compact` | 1T | 1T |

The unit table's `point` was 0.3528 mm, the `convert` package's figure cut to four places, where a typographic point is exactly a 72nd of an inch, 0.3527777... mm; the `pica` beside it was cut the same way (4.2333 mm for a sixth of an inch). The generator now corrects both on the way through, as it does the square decimetre, and records why.

| line | before | now |
| --- | --- | --- |
| `(1 pica in points) to 10 dp` | 11.9991496599 points | 12.0000000000 points |
| `(1 inch in points) to 10 dp` | 71.9954648526 points | 72.0000000000 points |

The boundary: the compact form below a thousand trillion is unchanged, and so is `as engineering`. The table's other rounded entries are upstream's own rounding choices and stay mirrored; the point and the pica are corrected because their definitions are exact and the cut broke the relation between them. The generated unit reference page lists the new values once it is regenerated.

## Verification

`FoundBug_compactExponent.spec.ts` holds 16 tests: the lines above, the tiers below the limit unchanged, a sweep of every power of ten to 308 that no answer mixes an exponent with a suffix, unit tests of `compactParts` at the tier and limit boundaries, zero, negative zero, the smallest and largest doubles (whose three-figure rounding reads back as Infinity, now written from the double) and the non-finite values, and the adversarial cases. `FoundBug_typographicPoint.spec.ts` holds 14 tests: the table's values, their agreement with `typographic point`, the defining relations, what a reader sees, and the adversarial cases. `ConvertParity.spec.ts` skips the four corrected spellings and pins them in a DEVIATION test. Gates run: `npm run typecheck`, `npm run typecheck:tests` (no new errors), `npm run lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet` and `lint:sidebar` all clean; `lint:units` passed against a fresh build; and the full suite (`npm run test:full`) passed, 22,772 of 22,776 tests in 697 suites with 4 skipped. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
