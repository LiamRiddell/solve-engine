---
title: "A lab note"
description: A measurement written up as it is taken: readings with their uncertainty, a derived result to the right number of figures, a check against the expected value, and the unit conversions around it.
---

A measurement is only as good as its uncertainty: a density of 2.48 g/mL means
little until you know whether it could be 2.3 or 2.6. This note writes a
measurement up the way a lab book does, carrying the uncertainty through the
arithmetic, rounding the result to the figures the readings support, and
checking it against the value it should be.

```solve-doc
# Density of the sample
Mass in g: :mass = 12.4 +/- 0.1              // 12.4 ± 0.1
Volume in mL: :volume = 5.0 +/- 0.2          // 5 ± 0.2
Density in g/mL: mass / volume               // 2.48 ± 0.1
prev to 2 sf                                 // 2.5
check mass / volume ≈ 2.5 within 5%          // ✓ (differs by 0.8%)

# Units around it
12.4 g / 5 mL                                // 2.48 g/mL
12.4 g / 5 cm^3                              // 2.48 g/cm³
2.5 kg * 9.81 m/s^2                          // 24.53 N
21.5 °C in K                                 // 294.65 K
101.3 kPa in atm                             // 1.00 atm
0.5 mm in µm                                 // 500.00 µm
```

## What each part is doing

**`12.4 +/- 0.1`** is a reading and its uncertainty: 12.4, give or take 0.1.
The engine carries the spread through the arithmetic, so `mass / volume` is
2.48 give or take 0.1, the spread worked out from both readings' spreads rather
than guessed. See [uncertainty](/syntax/uncertainty/).

**The units are in the labels.** A value with an uncertainty is a plain number:
the engine drops a unit written with it, because it cannot yet carry both
through the arithmetic, and refuses to mix a value with an uncertainty and one
with a unit rather than quietly losing one of them. So the grams and millilitres
are in the text before each colon, and the unit conversions sit in a part of
their own below.

**`prev to 2 sf`** rounds to two significant figures, the figures counted from
the first one that is not zero. Two is what a volume known to 0.2 in 5.0
supports, so 2.5 is the honest way to report the density. See
[rounding](/syntax/rounding/).

**`check mass / volume ≈ 2.5 within 5%`** compares the result with the value it
should be, allowing a margin. It passes and says how close it came; a result
outside the margin would fail and show both sides. See
[conditionals](/syntax/conditionals/).

**The units part** works in quantities that carry their unit: a mass over a
volume is a density, a mass times an acceleration is a force (the engine writes
it in newtons, `N`), and each converts to another unit of the same kind with
`in`. See [unit arithmetic](/syntax/unit-arithmetic/) and
[converting units](/syntax/converting-units/).

## What the note leaves out

The spread is combined the standard way for readings that vary independently,
which is right for a mass and a volume taken with different instruments and
not for two readings that share a source of error. The mole is not a unit the
engine reads yet, so an amount of substance is written as a plain number.
