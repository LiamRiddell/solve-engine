---
"solve-engine": patch
---

Every function keeps, reads or refuses a quantity by name: `trunc` and `hypot` keep the unit, the degree forms read an angle, the counting functions refuse a length, and `root` of a negative number is real for an odd degree

After #587 refused a quantity in `sin`, `log` and `exp`, a sweep of every builtin with a quantity argument found more that read its bare number, the same in 2.39.0 (#592). Each is now sorted the way its siblings already were.

| expression | before | now |
| --- | --- | --- |
| `trunc(3.7 m)` | 3 | 3.00 m, as `floor(3.7 m)` is |
| `hypot(3 m, 400 cm)` | 400.01, the two lengths read as 3 and 400 | 5.00 m |
| `sind(1 rad)` | 0.02, the sine of one degree | 0.84, the sine of one radian |
| `fact(3 m)` | 6 | error: fact takes a plain number, not a length |
| `gcd(4 m, 6 m)` | 2 | error: gcd takes a plain number, not a length |
| `atan2(1 m, 2 kg)` | 0.46 | error: length and mass cannot be compared |
| `pow(2, 3 m)` | 8 | error: An exponent cannot carry a unit (m), as `2^(3 m)` says |
| `root(3, -8)` | NaN | -2 |
| `root(2, -4)` | NaN | error: root(2, -4) has no real value |

The functions that keep a unit are the ones that change a quantity's size without changing what it measures: the rounding family (`trunc` and `int` join `round`, `floor` and `ceil`), `abs`, and `hypot` of quantities that all measure one thing, read in the first one's unit. `atan2` of two such quantities is their angle, read in a shared unit. The degree forms (`sind`, `cosd`, `tand`) and `degtorad` read a bare number as degrees and an angle in its own unit; `radtodeg` reads a bare number as radians. The counting functions (`fact`, `gcd`, `lcm`, `permutation`, `combination`), the bit functions (`clz32`, `imul`, `fround`, `hex`, `bin`), `asind`, `acosd`, `atand`, and a unit on `root`'s degree are refused by name.

The boundary: `sign` of a quantity is its sign, a plain number, as it was. A mix of a quantity and a plain number in `hypot` or `atan2` is refused rather than guessed at, since a side with no unit has no length to compare.

The number-functions page carries proven examples.

## Verification

New tests pin each function with a quantity, an angle and a plain number, and the plain forms that must not change. `npm run verify:ci` passes.
