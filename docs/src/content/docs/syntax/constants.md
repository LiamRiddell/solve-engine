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
| `electron mass` | 9.1093837015 × 10⁻³¹ | kg |
| `proton mass` | 1.67262192369 × 10⁻²⁷ | kg |

`electron mass` and `proton mass` carry their kilograms, so they convert and
combine like the other dimensioned constants.
