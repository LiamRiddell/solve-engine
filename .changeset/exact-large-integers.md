---
"solve-engine": patch
---

Whole numbers past 2^53 stay exact

A double holds every whole number up to 9,007,199,254,740,991 exactly and only some of them beyond it, so an integer result past that line was rounded to its nearest double. The display then printed digits the answer does not have, and anything built on the result inherited the error: `7^77 mod 13` took its remainder from a number with the wrong low digits. Such a result is now computed exactly, as a bigint, whenever adding, subtracting, multiplying or raising whole numbers produces it.

| expression | before | now |
| --- | --- | --- |
| `3^40` | 12,157,665,459,056,929,000 | 12,157,665,459,056,928,801 |
| `2^53 + 1` | 9,007,199,254,740,992 | 9,007,199,254,740,993 |
| `2^64` | 18,446,744,073,709,552,000 | 18,446,744,073,709,551,616 |
| `fact(25)` | 15,511,210,043,330,986,000,000,000 | 15,511,210,043,330,985,984,000,000 |
| `7^77 mod 13` | 2 | 11 |
| `combination(56, 23)` | 3,167,295,784,216,201 | 3,167,295,784,216,200 |
| `lcm(2^40, 3^20)` | 3,833,759,992,447,475,000,000 | 3,833,759,992,447,475,122,176 |
| `(2^53 + 1) as hex` | 0x20000000000000 | 0x20000000000001 |
| `(2^60 + 1) * $1` | $1,152,921,504,606,846,976.00 | $1,152,921,504,606,846,977.00 |

The result is still a Number, not a bigint. The exact integer rides on it as the `rational` sidecar that integer division already uses for `1/3`, so the next `+`, `-`, `*`, `/`, comparison and `as fraction` read it without change, and a unit, a percentage or money meets an ordinary number. `mod`, `floor`, `ceil`, `round`, `trunc`, `int`, `abs`, `gcd`, `lcm`, `pow`, `fact`, `permutation`, `combination`, `as hex`, `as binary`, `as octal`, `to N dp` and money multiplication read the exact value; the formatter prints its digits, grouped and localised like any other number. `toNumber()` returns the nearest double, as before, so a host reading a result's number is unaffected, and `value.rational.n` holds every digit.

This reverses a recorded decision. `ArithmeticFloatingPoint.spec.ts` pinned `2^53 + 1` as 2^53 and declined a promotion to BigInt because it would change an expression's type with its magnitude. Carrying the exact value on a Number keeps the type, which was the objection, so the test now asserts the exact integer. `fact(170)`'s double also moves from 7.257415615307994e306 to 7.257415615307999e306, the nearest double to the true value rather than a running product's drift.

The boundary is provenance, and it is deliberate:

- A number **typed** past the safe range is rounded as it is read, so its digits may already be invented. It seeds no exact value, and `1e16 + 1 - 1e16` is still 0, while `10^16 + 1 - 10^16` is now 1. The `n` suffix remains the way to type a large exact integer.
- A result past a double's range (about 1.8 × 10^308) is Infinity, as it was, so `2 ^ 100000` is unchanged, and the exact work this adds is never more than 1,024 bits.
- A fractional part, a unit (`(2^53 + 1) kg`) and a percentage read the nearest double. So do the transcendental functions, which have no exact integer answer to keep.

A big integer typed with `n` still prints its digits without grouping; making the two displays agree is a separate decision. The big integers page is rewritten to explain the safe range, what stays exact and where it stops, and the TypeScript guide says where the exact value lives on a result.

## Verification

A new suite pins each answer above, every operator and function that reads the exact value, each boundary, the display under separator and locale settings, and a variable carrying the value between lines. An A/B run of 3,863 expressions against the previous build differed on 543: 488 match an independent BigInt reference, 44 more are corrections checked by hand, and 11 are random functions; none regressed. An interleaved in-process benchmark of the plain `+`, `-`, `*`, `/` and `^` paths measured ratios between 0.96 and 1.06 across runs, within noise. The CI vm suite, which runs under Jest's sandbox, first measured `1 + 2` at twice its cost, because the range test read `Number.MAX_SAFE_INTEGER` off the global on every operation; the limit is now a module constant, and that suite measures 0.81 ms against the previous 0.80 to 0.84 ms per 2,000 runs. Differential fuzzing (the document generator, and 20,000 expression cases) found nothing. `npm run verify:ci` passes: 9,614 tests across 488 suites, with the bundled-consumer contract.
