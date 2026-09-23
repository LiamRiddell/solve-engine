---
"solve-engine": patch
---

A power written on a unit makes an area or a volume, and a power with no unit to give is refused

`5 m^2` was read as five metres, squared, and the power handler had no reading for a unit, so it answered a bare 25. `10 m^3 in litres` then labelled that bare 1,000 as litres, a tenth of the true answer. Each result looked plausible, and nothing on screen said the unit had gone.

The power now belongs to the unit it is written on, the way a physics book reads it: `5 m^2` is five square metres. A quantity in brackets is raised as a whole, and a square or cube root takes an area or a volume back to a length.

| expression | before | now |
| --- | --- | --- |
| `10 m^3 in litres` | 1,000.00 litres | 10,000.00 litres |
| `1 m^3 in L` | 1.00 L | 1,000.00 L |
| `5 m^2` | 25 | 5.00 m2 |
| `5 m^2 in ft2` | 25.00 ft2 | 53.82 ft2 |
| `(3 m)^2` | 9 | 9.00 m2 |
| `sqrt(16 m^2)` | 16 | 4.00 m |
| `sqrt(1 ha)` | 1 | 100.00 m |

Only a length has a square or a cube with a unit, so any other power or root of a quantity is now an error instead of the bare number. That covers `5 kg^2`, `sqrt(16 m)`, a speed squared, and a power or root of an amount of money: `(5 USD)^2` used to answer 25 and `sqrt($100)` 10, and the tests that pinned those numbers now assert the refusal. A ratio of like amounts is a plain number, so `($2000 / $1000)^(1/5)` is unaffected. `m/s^2` is still read as acceleration; the same shape in any other unit, such as `9.81 ft/s^2`, which used to answer a bare 96.24, is refused.

`1 m3 in L` now converts, where it used to be a parse error, and so does a currency symbol as the target, as in `100 EUR in €`. A unit literal takes a following `in` or `to` as its own conversion only when a unit, `?` or `best` comes next; the lexer marks neither `L` nor `€` as a unit, so those conversions are left to the outer `in`, which reads them.

The boundary: this covers a length squared or cubed, and nothing wider. The superscript `m²` is not accepted as input. A unit written after an exponent, as in `10^3 m`, is the separate fix #535, and a product of two lengths, `5 m * 3 m`, is #533. A fuller algebra of units is #513.

## Verification

New tests pin every form above, the named refusals, the forms that already worked, and the spelling helpers, and the unit arithmetic page gains proven examples for squares, cubes and roots. `npm run verify:ci` passes: 9,566 tests across 487 suites.
