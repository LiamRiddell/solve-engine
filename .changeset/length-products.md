---
"solve-engine": patch
---

Lengths multiply into areas and volumes

Multiplying two lengths converted the right one into the left one's unit and then kept only that unit, so `5 m * 3 m` was reported as 15 m and a room's floor area came out as a length. A length times a length is now an area, and a length times an area is a volume, in either order. The left operand's unit sets the answer's, the same rule addition follows.

| expression | before | now |
| --- | --- | --- |
| `5 m * 3 m` | 15.00 m | 15.00 m2 |
| `5 m * 3 ft` | 4.57 m | 4.57 m2 |
| `2 m * 3 m * 4 m` | 24.00 m | 24.00 m3 |
| `5 m * 3 m in ft2` | error: a length cannot be converted to an area | 161.46 ft2 |
| `5 m2 * 3 m` | error: area and length cannot be multiplied | 15.00 m3 |
| `5 m2 * 3 m2` | 15.00 m2 | error: no unit |

An area times an area, or a volume times anything, is a product of more than three lengths and has no unit, so it is refused by name where it used to be reported in the left operand's unit. The product keeps exact decimals, so `0.1 m * 0.2 m == 0.02 m2` is true. A test in the derived units suite pinned the old `15.00 m` and now asserts the area, and the derived units page, which described the old reading as intended, is corrected.

The boundary: quotients are unchanged, so `15 m2 / 3 m` still shows as `5.00 m2/m` rather than simplifying to a length. That, and the rest of a fuller algebra of units, is #513.

## Verification

New tests pin each product above, the refusals, the exact-decimal case, and the products that keep their own rules (a newton, a joule, a mass times a length). The unit arithmetic page gains proven examples for products of lengths. `npm run verify:ci` passes: 9,582 tests across 487 suites.
