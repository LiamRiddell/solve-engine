---
title: Constants
description: "Named physical and mathematical constants, like the speed of light and gravity, ready to compute with."
---

> **Package:** `CONSTANTS_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Reach for a well-known constant by name instead of typing the digits. Where a
constant has a unit, it arrives as a proper quantity, so it converts and
multiplies like any other measurement.

## Dimensioned constants

The speed of light and the acceleration of gravity carry their units:

```solve
speed of light // 299,792,458.00 m/s
gravity // 9.81 m/s²
```

Because they are real quantities, they take part in the arithmetic. Gravity times
a mass is a force, and it reads out in newtons through the
[named derived units](/syntax/derived-units/#named-derived-units):

```solve
gravity * 70 kg as N // 686.47 N
speed of light in km/h // 1,079,252,848.80 km/h
```

## Mathematical constants

`tau` is a full turn, 2π, and the `golden ratio` (also `phi`) is the proportion
that appears throughout art and nature. `pi` and `e` are already built in.

```solve
tau // 6.28
golden ratio // 1.62
```

## Physical constants (values)

These are precise scientific values. Avogadro's number is large enough to show
in full; the others are so small that the default display rounds them, so they
are listed here with their proper values and units:

```solve
avogadro // 602,214,076,000,000,000,000,000
```

| constant | value | unit |
| --- | --- | --- |
| `planck` | 6.62607015 × 10⁻³⁴ | J·s |
| `boltzmann` | 1.380649 × 10⁻²³ | J/K |
| `elementary charge` | 1.602176634 × 10⁻¹⁹ | C |
| `gas constant` | 8.314462618 | J/(mol·K) |
| `avogadro` | 6.02214076 × 10²³ | mol⁻¹ |
| `electron mass` | 9.1093837015 × 10⁻³¹ | kg |
| `proton mass` | 1.67262192369 × 10⁻²⁷ | kg |

`electron mass` and `proton mass` carry their kilograms, and `boltzmann` its
joules per kelvin, so they convert and combine like the other dimensioned
constants: the Boltzmann constant times a temperature is an energy.

```solve
boltzmann // 1.38e-23 J/K
boltzmann * 300 K // 4.14e-21 J
```

The rest are in units the engine cannot write yet: a joule-second, a coulomb
(the unit of electric charge), and anything per mole (the chemist's count of
particles). Each of them is a plain number, and scaling one by a plain number
works as it always has. What is refused is meeting a quantity, since a plain
number takes the other side's unit and the answer would be labelled wrongly:
Planck's constant times a frequency is an energy, not a number of hertz.

```solve
planck * 5e14 // 3.31e-19
avogadro * 2 // 1,204,428,152,000,000,000,000,000
planck * 5e14 Hz // A constant measured in J·s and a quantity in Hz cannot be multiplied: the engine cannot spell J·s yet, so the answer would wrongly be in Hz. Leave the unit off the other side and read the result in the unit it should have.
```

The refusal applies to the constant itself, as written or held in a variable. A
value already worked out from one, `planck * 2`, is an ordinary number.
