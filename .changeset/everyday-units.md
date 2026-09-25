---
"solve-engine": minor
---

The everyday units are read: `2000 kcal in kJ`, `10 Ω`, `3000 mAh * 3.7 V`, `20 knots in km/h`, `120 mmHg in kPa`, `12 volts`, `2 L` and `1 mol`

Food energy, heating bills, batteries, engines and gas laws need units the table did not have, and each was refused as an undefined variable (#706). A voltage divided by a current stayed `V/A` rather than becoming an ohm.

| line | before | now |
| --- | --- | --- |
| `2000 kcal in kJ` | throws `Undefined variable: kcal` | 8,368.00 kJ |
| `1 calorie in J` | throws `Undefined variable: calorie` | 4.18 J |
| `100000 BTU in kWh` | throws `Undefined variable: BTU` | 29.31 kWh |
| `1 therm in kWh` | throws `Undefined variable: therm` | 29.31 kWh |
| `1 eV in J` | throws `Undefined variable: eV` | 1.6e-19 J |
| `10 Ω` | throws `Undefined variable: Ω` | 10.00 Ω |
| `12 V / 2 A` | 6.00 V/A | 6.00 Ω |
| `3000 mAh * 3.7 V` | throws `Undefined variable: mAh` | 11.10 Wh |
| `3000 rpm in Hz` | throws `Undefined variable: rpm` | 50.00 Hz |
| `1 revolution in deg` | throws `Undefined variable: revolution` | 360.00 deg |
| `20 knots in km/h` | throws `Undefined variable: knots` | 37.04 km/h |
| `1 AU in km` | throws `Undefined variable: AU` | 149,597,870.70 km |
| `120 mmHg in kPa` | throws `Undefined variable: mmHg` | 16.00 kPa |
| `12 volts` | throws `Undefined variable: volts` | 12.00 volts |
| `5 amps` | throws `Undefined variable: amps` | 5.00 amps |
| `2 L` | throws `Undefined variable: L` | 2.00 L |
| `1 mol` | throws `Undefined variable: mol` | 1.00 mol |

Each newly read form:

- **Energy**, beside the joules and kilowatt-hours already there: `cal`, `calorie` and `calories` (the small calorie), `kcal`, `kilocalorie`, `kilocalories`, `Cal`, `Calorie` and `Calories` (the food Calorie, a thousand small ones), `BTU` and `Btu`, `therm` and `therms`, and `eV` with `keV`, `MeV` and `GeV`.
- **Electricity**: `volt` and `volts` beside `V`; `amp`, `amps`, `ampere` and `amperes` beside `A`; the ohm, a new measure, as `ohm`, `ohms`, `Ω`, `kΩ` and `MΩ`, with the symbol read in both the Greek capital omega and the ohm sign (U+2126) a pasted datasheet can carry; and charge, a new measure, as `Ah`, `mAh`, `coulomb` and `coulombs`.
- **Electrical arithmetic**: a voltage over a current is a resistance in ohms, a voltage over a resistance or a power over a voltage is a current in amps, a current for a time is a charge in amp-hours, a charge in amp-hours at a voltage is a battery's energy in watt-hours, and a watt-hour energy over a voltage is its charge in amp-hours. `2 A * 6 Ω` is 12.00 V, `12 V / 6 Ω` 2.00 A, `2 A * 3 h` 6.00 Ah and `11.1 Wh / 3.7 V` 3.00 Ah.
- **Speed and rotation**: `knot` and `knots` beside `kn`; `rpm` and `RPM` as a frequency (3,000 rpm is 50 Hz); and `revolution` and `revolutions` as the angle of one full turn.
- **Length, pressure and amount of substance**: `AU`, the astronomical unit; `mmHg`, the millimetre of mercury; and `mol` and `mmol`, the mole, a new measure.
- **The litre's capital**: `L`, the symbol most bottles print, joins `l`, `mL` and the rest.

The spellings that needed a decision, and what was decided. The food Calorie is a kilocalorie and the physics calorie is not, and the lexer is case-sensitive, so the capital is the food figure as a label prints it (`Cal`, `Calorie`) and every lower-case spelling is the small calorie as a physics text writes it: `2000 calories in kJ` is 8.37 kJ, and a food figure is written `kcal` or `Cal`. The calorie is the thermochemical 4.184 J, the size food energy is reckoned in, not the International Table 4.1868 J. The BTU is the International Table one, exactly 1,055.05585262 J, and a therm is 100,000 of those, as the UK and EU therm is. The millimetre of mercury is its conventional 133.322387415 Pa, kept apart from the torr it differs from by less than one part in seven million. The mole enters as a conversion unit only: the dimensional arithmetic tracks mass, length, time and current, the amount of substance is a fifth base quantity outside them, and no named unit is made from it, so `mol` converts to `mmol` and nothing else. A charge worked out by arithmetic is named in amp-hours, the unit a battery is rated in, since the coulomb's symbol `C` is Celsius; `in coulombs` gives the SI figure.

Three answers change with it. A unit after a number wins over a variable of the same name, as it always has for `b` and `N`, so where `L`, `amp`, `volts`, `therm` and the other new words were names, the line straight after a number now reads the unit. On its own and after an operator the name is still the variable, so `L * 2` is still 6 and `2 * L` is the product. A power over a voltage now names its current, and a current for a time, which was refused, is now a charge.

| line | before | now |
| --- | --- | --- |
| `L = 3` then `2L` | 6 | 2.00 L |
| `L = 3` then `2 L` | 6 | 2.00 L |
| `amp = 3` then `2 amp` | 6 | 2.00 amp |
| `24 W / 12 V` | 2.00 W/V | 2.00 A |
| `2 A * 3 h` | `current and duration cannot be multiplied` | 6.00 Ah |

The boundary: `kt` stays the kilotonne (the knot is `kn`, `knot` or `knots`), `C` stays Celsius so the coulomb is spelled only as a word, and `turn` and `turns` stay excluded as ordinary English while `revolution` names the same angle. The lower-case `au` is not the astronomical unit, since it starts `au pair`, and the word `mole` is not the unit. The US therm, built on an older BTU, is about 0.02% smaller than the therm here. A charge over a current is not named as a time, as an energy over a power is not, so `3000 mAh / 500 mA` stays `6.00 mAh/mA`; frequency does not multiply with a time, so `3000 rpm * 2 min` is refused; and speed, acceleration and frequency in unit arithmetic are a separate item. The `as` readouts gain no names for the ohm, the amp or the amp-hour, because they are matched without case and `mΩ` and `MΩ` would be one name; `in` converts any of them. `amp`, `volts`, `knots`, `revolution` and `calories` are English words too, and a sentence that uses one is left unanswered: with no number before the word it starts with a plain name, and with one it fails to parse rather than answering. Five syntax pages are new (energy units, electricity, pressure, distances in space and moles), the knot and rpm join the rates and speeds page, the capital `L` joins converting units and variables, the named derived units page gains the ohm, the ampere and the amp-hour, and the unit reference is regenerated.

## Verification

`Issue706_everydayUnits.spec.ts` holds 535 tests: every spelling the issue names, the charge and resistance compositions, the amp-hour and watt-hour naming, a variable named `L`, `amp`, `therm` or `volts` defined above the line, each new word inside prose, words naming inherited properties as unit names, and mixed-measure refusals. The unit vocabulary, collision, measure-name, table-integrity, conversion-invariant, unit-power and parity specs gain the new spellings.

The full suite (`npm run test:full`) passed, 16,937 of 16,941 tests in 627 suites with 4 skipped, and `npm run verify:ci` passed end to end, including the three-zone temporal run (3,220 tests in 94 suites each) and the bundled-consumer contract (25 checks against an installed copy, including 1,584 documented examples).
