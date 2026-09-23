---
"solve-engine": patch
---

A tolerance written as a percentage or in another unit has the right width

The spread in `value ± spread` was read as a bare number whatever it was written as. A percentage became its proportion, so `100 ± 5%` was `100 ± 0.05`; and a tolerance in a different unit from the value had both units dropped before either was converted, so `5 m ± 1 cm` was `5 ± 1`, a spread a hundred times too wide. A percentage tolerance is now relative to the value, and a tolerance with a unit is converted into the value's unit before the unit is dropped.

| expression | before | now |
| --- | --- | --- |
| `100 +/- 5%` | 100 ± 0.05 | 100 ± 5.0 |
| `12.3 +/- 2%` | 12.3 ± 0.02 | 12.3 ± 0.25 |
| `5 m +/- 1 cm` | 5 ± 1.0 | 5 ± 0.01 |
| `1 kg +/- 5 g` | 1 ± 5.0 | 1 ± 0.005 (shown as 0.01 at two places) |
| `20 C +/- 1 F` | 20 ± 1.0 | 20 ± 0.56 |
| `5 m +/- 1 kg` | 5 ± 1.0 | error: they do not measure the same thing |
| `5 +/- 1 cm` | 5 ± 1.0 | error: the value has no unit to read it in |
| `45% +/- 3%` | 0.45 ± 0.03 | 0.45 ± 0.03 |

A temperature tolerance is converted as a width rather than as a reading, so 1 °F on a Celsius value is 5/9 of a degree, not the -17.2 °C that converting 1 °F as a temperature gives. On a value that is itself a percentage the tolerance stays in percentage points, as a poll's margin of error is read, so `45% ± 3%` is unchanged.

The boundary: the value's own unit is still dropped once the spread is converted, as the uncertainty page documents, since carrying units through the quadrature rules is a larger change. A tolerance in a unit that cannot be converted to the value's, or on a value with no unit, is refused with `UNCERTAINTY_UNIT_MISMATCH` rather than having its unit discarded. A currency tolerance in a different currency converts at the cached rate and is refused when none is available.

## Verification

A new suite pins each form above, including the temperature interval, the percentage-point reading, propagation of a relative spread, and the refusals, with the existing percentage-arithmetic suites unchanged. The uncertainty page gains sections on percentage and unit tolerances with proven examples and a `solve-doc` block of the refusals. An A/B run of 3,863 expressions against the previous build differed only on random functions. `npm run verify:ci` passes: TESTS tests across SUITES suites.
