---
"solve-engine": minor
---

Add fuel economy and named derived units (issues #190, #191).

Two unit features. Fuel economy converts between the two ways it is quoted; named
derived units let a product of quantities read out under its proper name for the
first time.

## Fuel economy

Miles per gallon and litres per 100 km measure the same thing opposite ways
round (distance per fuel against fuel per distance), so converting between them
is a reciprocal, not a rescale. That conversion is new.

| expression | result |
| --- | --- |
| `40 mpg in l/100km` | `5.88 l/100km` |
| `6 l/100km in mpg` | `39.20 mpg` |
| `30 mpg in km/l` | `12.75 km/l` |

`mpg` is miles per US gallon (the shipped gallon). A distance-per-fuel to
distance-per-fuel conversion (`mpg` to `km/l`) already rescaled each axis; only
the reciprocal pairing needed the new route.

## Named derived units

Multiplying two compatible quantities now tracks the unit exponents through the
operation, so a compound maps back to its named derived unit on output. This is
the slice the 1.1.0 changelog deferred, because the engine had no dimensional
algebra.

| expression | result |
| --- | --- |
| `70 kg * 9.81 m/s^2 as N` | `686.70 N` |
| `230 V * 13 A as W` | `2990.00 W` |
| `50 N * 4 m as J` | `200.00 J` |
| `2000 W * 3 hours as kWh` | `6.00 kWh` |

`m/s^2` finally means acceleration rather than a squared rate, and the newton
symbol `N`, the joule `J`, and the volt `V` now lex so the quantities can be
typed. The engine also names the result without an explicit `as`.

## The boundaries

- **It stops at compatible quantities.** A product that names a derived unit
  (`kg * m/s^2` is a newton) composes; one that names nothing (`m * m`) is left
  exactly as it was, and a genuine mismatch (`kg * m`) is still reported as one.
  A fuller algebra of units, and units to arbitrary powers, are a later slice.
- **The gallon is the US gallon**, so `mpg` is miles per US gallon; a UK variant
  would be a separate spelling rather than a silent regional switch.
- **`V` is the volt.** It does collide with the Visa stock ticker, but the
  bare-ticker form is opt-in and volts is the broader reading of `V` after a
  number.

## Verification

`npm run verify` (typecheck, the full test suite, build, the package smoke script
and the bundled-consumer tree-shaking contract) passes, along with `npm run
lint`, the comment-style and doc-coverage checks, and the docs example suite (the
fuel-economy and derived-unit examples are proven live on the units page). New
tests: `packages/fuel/FuelEconomy.spec.ts` and `packages/derived/DerivedUnits.spec.ts`.
