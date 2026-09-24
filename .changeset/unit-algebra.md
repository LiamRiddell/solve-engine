---
"solve-engine": minor
---

Units multiply, divide and cancel the way numbers do

A product or quotient of two quantities now carries the unit the two make together, a rate cancels against the quantity it is per, and a root takes an area or a volume back to a length. Where the combined unit is not one the engine can show, the answer is a named error rather than a number wearing the left operand's unit. This is what makes paint and tile coverage, appliance running costs and journey times work as they are written.

| expression | before | now |
| --- | --- | --- |
| `6 kWh * $0.30/kWh` | error: Undefined variable: kWh | $1.80 |
| `3 kg * $5/kg` | 15.00 USD/kg | $15.00 |
| `2 kW * 3 h * $0.30/kWh` | error: Undefined variable: kWh | $1.80 |
| `2 kW * 3 h` | 21,600,000.00 J | 6.00 kWh |
| `20 m² / (5 m²/l)` | error: Undefined variable: m² | 4.00 l |
| `20 m2 / (5 m2/l)` | 4.00 m2/m2/l | 4.00 l |
| `15 m2 / 3 m` | 5.00 m2/m | 5.00 m |
| `(9 m2)^0.5` | error: cannot be raised to the power 0.5 | 3.00 m |
| `10 lbf * 3 ft` | error: force and length cannot be multiplied | 40.67 J |
| `60 mph * 2 hours` | error: speed and duration cannot be multiplied | 120.00 mi |
| `120 km / 60 km/h` | 2.00 km/km/h | 2.00 h |
| `100 miles / 30 mpg` | 3.33 miles/mpg | 3.33 gal |
| `$100 / ($5/kg)` | 20.00 USD/USD/kg | 20.00 kg |
| `$30/hour * 8 hours/day` | error: different measures | 240.00 USD/day |
| `$500 at $20/h` | 25.00 hs | 25.00 h |
| `15 m² in ft²` | error: Undefined variable: m² | 161.46 ft² |
| `2 kg * 3 kg` | 6.00 kg | error: no unit |
| `$5 * $3` | $15.00 | error: no unit |
| `(100 km/h) / (2 h)` | 50.00 km/h/h | error: no unit |

A price written straight after an amount (`$5/kg`, `£2 per kg`) is now one rate, where the rate used to attach to everything before it, which is why `3 kg * $5/kg` read as `(3 kg * $5) per kg`. A denominator spelled in capitals (`kWh`, `GB`, `MJ`) is recognised; the table is case-sensitive and the lookup only tried the lowercase spelling. The single-word rates (`mph`, `mpg`, `Mbps`, `lpm` and the rest) cancel as the slash spellings do. Two rates that share a unit cancel it between them, and a quotient of two rates of the same kind is a plain ratio. A count of what a price is per takes the word's plural, so `$100 / $5/hour` is 20 hours, and the plural must now be the same unit: `$500 at $20/h` answered 25 hectoseconds (`hs`) and `$500 at $20/m` 25 milliseconds, because a symbol with an `s` added is often another unit.

An area over a length is a length, a volume over an area is a length, and a volume over a length is an area. A power of a half on an area, or a third on a volume, is its square or cube root. Every spelling of a mass, length, time, force, energy, power, pressure, voltage or current now takes part in naming a derived unit, so `10 lbf * 3 ft` is 40.67 J and `100 Pa * 2 m²` is 200.00 N, and a power for a time of a minute or more is named in watt-hours with the power's prefix.

An area or volume the engine works out is now printed with a superscript, `15.00 m²` where it was `15.00 m2`. `m²`, `ft²` and `m³` are units as typed. Every spelling of one unit is the same table entry, so a worked-out `m²` converts, compares and adds with `m2`, `sq ft` and `square metres` (`5 m * 3 m == 15 m2` is true). An area in words is a power of the length it names, so `sqrt(9 square feet)` is 3.00 ft.

A like product of anything but lengths is refused as `UNIT_PRODUCT_UNSUPPORTED`: a mass times a mass, a time times a time, money times money. A quotient with a compound rate that cancels nothing is refused as `UNIT_QUOTIENT_UNSUPPORTED`. Money times a count keeps its own rule, so `$30 * 4 days` is still $120.00. Two tests that pinned the old answers, `5 g * 10 g` as 50 and `$5 * $3` as not an error, now assert the refusal, and the allocation test that squared money in a loop is refused at its first step.

The boundary: this is not a general algebra of units. A product with no unit in the table, such as a kilogram-metre or a metre to the fourth power, is refused rather than shown. A plain number divided by a quantity is covered separately, in #570. A rate cancels against the quantity it meets, so `$0.30/kWh * 2 kW * 3 h` is refused where `2 kW * 3 h * $0.30/kWh` works. A single capital letter after a slash (`$0.50/W`) stays a variable, since `N` and `W` are common names for a count. There is no unit for an amount of substance, so `mol` and gas-law formulas such as PV = nRT are a later addition.

## Verification

A new suite pins every product, quotient, root, spelling and rate above, the named refusals, and the forms that keep their own rules (money times a count, a length over an area, a single capital after a slash); the derived units suite gains the wider spellings and the watt-hour naming. A new page, multiplying and dividing units, holds proven examples for each form, and the unit arithmetic, derived units and rates pages point to it. The unit reference is regenerated for the new spellings. `npm run verify:ci` passes: 11,654 tests across 535 suites, with the bundled-consumer contract.
