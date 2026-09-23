---
"solve-engine": patch
---

A unit after a power of ten belongs to the power, and two units side by side are refused

A unit binds tighter than `^`, so `10^3 m` parsed as ten to the power of three metres. The power read its exponent as a bare 3 and answered the plain number 1,000, and `10^3 m in km` then labelled that 1,000 as kilometres. Scientific notation puts the unit after the power, so a unit inside an exponent's operand now belongs to the whole power: `10^3 m` is a thousand metres and `10^-3 m` a millimetre. An exponent that still carries a unit, written inside brackets, is refused by name.

A second unit written straight after a quantity relabelled it, so `5 kg m` was five metres and `5 kg m in cm` 500 cm, the kilograms discarded without a word. Two units side by side name nothing the engine knows, so that is refused with `UNIT_AFTER_UNIT`.

| expression | before | now |
| --- | --- | --- |
| `10^3 m` | 1,000 | 1,000.00 m |
| `10^3 m in km` | 1,000.00 km | 1.00 km |
| `1.5 * 10^3 kg` | 1,500 | 1,500.00 kg |
| `10^-3 m in mm` | 0.001 mm | 1.00 mm |
| `2^(3 m)` | 8 | error: an exponent cannot carry a unit |
| `5 kg m` | 5.00 m | error: a quantity in kg cannot take a second unit |
| `5 kg m in cm` | 500.00 cm | error: a quantity in kg cannot take a second unit |
| `5 USD GBP` | £5.00 | error: a quantity in USD cannot take a second unit |
| `$5 CAD` | $5.00 in US dollars | $5.00 in Canadian dollars |
| `$5 kg` | $5.00 | error: a quantity in USD cannot take a second unit |

Two readings that leaned on the relabel are now made directly. A currency symbol is shared by several currencies, so a code after the amount that names one of them says which is meant: `$5 CAD` is Canadian dollars and `¥500 CNY` yuan, where the code used to be dropped. And `20 degrees C` is twenty degrees Celsius: a degree word between a number and a temperature scale names the scale, read by the degree rule rather than by relabelling an angle as a temperature.

The boundary: the same unit twice (`5 kg kg`, `$5 USD`) is let through, since it changes nothing, and a word the unit table does not know after money (`£60,000 salary per month`) is still read as a label. Compound units written with a slash (`km/h`, `m/s^2`) are joined into one unit before this point and are unaffected.

## Verification

A new suite pins every form above, the powers and conversions that are unchanged, the currency codes and labels, and the temperature-scale spellings. The unit arithmetic page gains sections on a unit after a power and on two units side by side, and the currency page on codes after a symbol, with proven examples. `npm run verify:ci` passes: 9,745 tests across 493 suites, with the bundled-consumer contract.
