---
"solve-engine": patch
---

`floor`, `ceil`, `round`, `int`, `trunc` and `as int` round an exact fraction past 2^53 from the fraction, so `floor(2^60 + 0.5)` is 1,152,921,504,606,846,976

`2^60 + 0.5` is not a decimal anyone typed but a sum, so the engine holds it as the exact fraction 2^61 + 1 over 2, and shows it as 1,152,921,504,606,846,976.50. The rounding functions read an exact integer or an exact decimal, and otherwise fell back to the double, which past 2^53 holds no fraction: they rounded 2^60 itself and wrote it in its sixteen digits, 1,152,921,504,606,847,000, a confident wrong number. All six now share one chain: an exact integer is handed back as it is, then an exact fraction is divided out in whole numbers, then an exact decimal is rounded in base ten, and only a value with none of these reads its double. `floor` rounds down and `ceil` up, `int`, `trunc` and `as int` drop the fraction towards zero, and `round` takes a half away from zero, as it already did for a small number.

| line | before | now |
| --- | --- | --- |
| `floor(2^60 + 0.5)` | `1,152,921,504,606,847,000` | `1,152,921,504,606,846,976` |
| `int(2^60 + 0.5)` | `1,152,921,504,606,847,000` | `1,152,921,504,606,846,976` |
| `(2^60 + 0.5) as int` | `1,152,921,504,606,847,000` | `1,152,921,504,606,846,976` |
| `ceil(2^60 + 0.5)` | `1,152,921,504,606,847,000` | `1,152,921,504,606,846,977` |
| `round(2^60 + 0.5)` | `1,152,921,504,606,847,000` | `1,152,921,504,606,846,977` |
| `floor(-(2^60 + 0.5))` | `-1,152,921,504,606,847,000` | `-1,152,921,504,606,846,977` |
| `int(-(2^60 + 0.5))` | `-1,152,921,504,606,847,000` | `-1,152,921,504,606,846,976` |
| `round(2^60 + 1/3)` | `1,152,921,504,606,847,000` | `1,152,921,504,606,846,976` |
| `floor(-7/2)` | `-4` | `-4` |
| `round(-2.5)` | `-3` | `-3` |

The boundary: a value with no exact reading keeps its double, as before, so a quantity (`floor((2^60 + 0.5) m)`), a result of `sqrt` and a number typed in scientific notation round what their double holds. A plain double is turned away by the chain on its first two reads, so the common path allocates nothing and does no more work than it did. The big integers page shows the six roundings of `2^60 + 0.5`, either sign.

## Verification

`FoundBug_roundingExactFractionsPastSafeRange.spec.ts` holds 29 tests: the lines that exposed it, each rounding of a negative, halves and thirds under `round`, exact arithmetic on the answer, small numbers unchanged, the boundary; unit tests of `roundExactRationalToWhole` (each rounding, a negative zero result, 2^53 ± a half, a 34-digit numerator, and no sidecar, a whole fraction, a zero or negative denominator, NaN, the largest double, text, a boolean and a quantity), of `roundExactDecimalToWhole` after its move onto the shared division, of `roundExactToWhole` (the order of the chain, a value carrying both sidecars, zero, negative zero, 2^53 ± 1, the largest and smallest doubles, NaN and the infinities) and of `truncateToWhole` taking it; and the adversarial cases (prototype words with `Object.prototype` unchanged, deep brackets, a long sum, a huge power, `2^3000 + 1/3`, text edges, digits from another script, a value from the line above with a check and a what-if through both document passes, money, and every numeric edge through each rounding). `AdversarialFeatureSweep.spec.ts` gains `floor((X) + 2^60 + 1/2)`, `round(-(X) - 2^60 - 1/2)` and `(X) + 2^60 + 1/3 as int`.

The fast suite ran across 780 suites (26,930 of 26,934 tests passed, 4 skipped, none failed), with `docs/public/llms-full.txt` regenerated for the changed pages. `npm run typecheck`, `typecheck:tests` (at its baseline of 92 errors in 29 files, none new), `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:links`, the proven docs examples and the hardening and integration suites passed. The benchmarks and `npm run verify` as one command were not run.

On top of main, the full suite ran 29,773 tests in 801 suites, all passing but 4 skipped once two package pages and one spec linked main's createQueryResolver section by its heading (in this change), and `npm run test:temporal` passed its 3,509 tests.
