---
"solve-engine": patch
---

A power after a slash belongs to the unit after it: `1000 kg/m^3` is a density, and `check` compares two rates that convert into each other

`1000 kg/m^3` threw "a power on a unit ... applies only to a length", which `m` is (#834). The compound-unit rule joined `kg/m` into one unit before the `^` was seen, and the power was then looked for on the whole of it. The power is now taken onto the unit after the slash: a length takes its square or cube spelling (`kg/m³`), and a time under a length takes its square, an acceleration (`ft/s²`). The `in` conversion takes a power on its target the same way, and the printed `ft/s²` reads back as a unit. A check refused to compare `g/mL` with `g/cm³` although converting between them worked; it now compares two quantities whenever one converts into the other.

| line | before | now |
| --- | --- | --- |
| `1000 kg/m^3` | throws `"kg/m^3" is not a unit` | 1,000.00 kg/m³ |
| `1 g/cm^3 in kg/m^3` | throws `"g/cm^3" is not a unit` | 1,000.00 kg/m³ |
| `9.81 m/s^2 in ft/s^2` | throws `"ft/s^2" is not a unit` | 32.19 ft/s² |
| `9.81 m/s^2 in ft/s²` | throws `Undefined variable: s²` | 32.19 ft/s² |
| `check 1 g/mL == 1 g/cm^3` | `check: g/mL and g/cm³ cannot be compared` | ✓ |

The boundary: a power after a slash makes a unit only on a length (squared or cubed) or on the time of an acceleration (squared). Anything else, `5 kg/s^2` or `9.81 m/s^3`, is refused by name, with a message that says what a power after a slash applies to. A power on the top of a rate (`m^2/s`) is not read. The multiplying and dividing units page gains the density examples and the check.

## Verification

`Issue834_powerAfterSlash.spec.ts` holds 99 tests: densities, a price per area and accelerations written with a power after the slash, the target powers, the refusals and their two messages, checks between rates in either direction and the refusals that stay, unit tests of `poweredRateUnit`, `isSquaredTimeUnder` and `rateInLeftUnit` with ordinary, boundary and hostile arguments, and the adversarial cases: prototype words on each side of the slash and under the square, absurd powers, look-alike digits and markup-shaped text, a document through both passes with a check over it, and the numeric edges. `UnitPowers.spec.ts` pinned `9.81 ft/s^2` as refused; it now pins `5 kg/s^2` and `9.81 m/s^3`.

The full suite (`npm run test:full`, which includes the lexer fuzz and long-document suites) passed, 21,509 of 21,513 tests in 681 suites with 4 skipped, as did `npm run typecheck`, `typecheck:tests`, `lint`, `lint:comments`, `lint:messages`, `lint:error-codes`, `lint:docs`, `lint:cheatsheet`, `lint:sidebar`, `lint:units` and `lint:keywords`, and the proven documentation examples all evaluate as documented. `npm run verify:ci` and the bundled-consumer contract were not run whole for this change; CI runs both.
