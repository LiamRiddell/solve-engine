---
"solve-engine": patch
---

A check compares exact values exactly and names two sides that read apart, and an exact large integer keeps its digits against an `n` whole number

Three places where features in this release met each other and disagreed, found by the cross-feature review before it shipped.

**A check agrees with its comparison (#581).** A check read both sides as doubles and treated them as equal within a relative 1e-12, a margin meant for a unit conversion's rounding. A decimal, money, a fraction and a whole number past 2^53 hold their value exactly, and `==` and the ordering operators compare them on it, so a check could pass what `==` called false and fail what `>` called true. Those kinds are now checked exactly; a pair of plain doubles keeps the margin, and `≈` and `within` are unchanged. An `n` whole number, which a check refused as incomparable, is compared on its digits.

| line | before | now |
| --- | --- | --- |
| `check 2^53 + 1 > 2^53` | error: check failed: 9,007,199,254,740,993 is not more than 9,007,199,254,740,992 | ✓ |
| `check 1.0000000000001 == 1` | ✓ | error: check failed: 1.0000000000001 is not equal to 1 |
| `check 5n == 5` | error: check: 5 and 5 cannot be compared | ✓ |
| `check 1 km == 1000 m` | ✓ | ✓ |
| `check sqrt(2)^2 == 2` | ✓ | ✓ |

**A failed check's sides read apart (#582).** A failure's sides differ, but they were shown at the result's usual two places, where `1.845` and `1.85` meet. They now widen a decimal place at a time until they part. Sides in different units are told apart in the left side's unit, since `1.00 km` and `1,000.00 m` read differently while meaning the same.

| line | before | now |
| --- | --- | --- |
| `check 12.3 kWh * $0.15/kWh == $1.85` | error: check failed: $1.85 is not equal to $1.85 | error: check failed: $1.845 is not equal to $1.850 |
| `check 3.1415926 ≈ 3.1415927` | error: check failed: 3.14159 is not equal to 3.14159 | error: check failed: 3.1415926 is not equal to 3.1415927 |
| `check 1 km == 1000.001 m` | error: check failed: 1.00 km is not equal to 1,000.00 m | error: check failed: 1.000000 km is not equal to 1,000.001000 m |

**An exact large integer against an `n` whole number (#583).** An exact result past 2^53 is a Number carrying its integer beside the nearest double. Where it met an `n` whole number, the arithmetic, bitwise and comparison paths read the double, which for `3^40` is 33 short.

| expression | before | now |
| --- | --- | --- |
| `3^40 - 12157665459056928801n` | -33 | 0 |
| `3^40 == 12157665459056928801n` | false | true |
| `(2^53 + 1) & 1n` | 0 | 1 |

The boundary: a number typed past 2^53 without the `n` suffix is still the double it was rounded to as it was read, as [big integers](/syntax/big-integers/) explains, so `check 3^40 == 12157665459056928801` fails, as `==` does. The checks section of [conditionals](/syntax/conditionals/) and the big-integers page carry proven examples of each change.

## Verification

New tests pin each exact kind through a check (a large integer, a decimal, money, a fraction, an `n` whole number), each widened failure message and the unchanged ones, and the `n` operators against exact results. `npm run verify:ci` passes.
