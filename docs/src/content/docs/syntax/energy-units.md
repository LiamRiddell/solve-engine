---
title: "Energy units"
description: Calories and kilocalories, BTU, therms and electronvolts, beside joules and kilowatt-hours.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Energy is the capacity to do work or to heat something, and different trades
count it in different units: a nutrition label in kilocalories, an electricity
bill in kilowatt-hours, a gas bill in therms, a boiler in BTU, a physicist in
joules or electronvolts. They all measure the same thing, so any one converts to
any other.

```solve
1 kWh in kJ // 3,600.00 kJ
2000 kcal in kJ // 8,368.00 kJ
1 therm in kWh // 29.31 kWh
```

## Calories

A calorie comes in two sizes a thousand apart, and the spelling says which. The
small calorie, `cal`, is roughly the energy that warms a gram of water by one
degree. The food Calorie on a nutrition label is a thousand of those, a
kilocalorie, and is written `kcal`, or `Cal` with a capital C as a label prints
it.

```solve
2000 kcal in kJ // 8,368.00 kJ
250 Cal in kJ // 1,046.00 kJ
1 kcal in cal // 1,000.00 cal
1 kWh in kcal // 860.42 kcal
```

The words follow the same rule, because units are case-sensitive: `calorie` and
`calories` in lower case are the small calorie, as a physics text writes them,
and `Calorie` and `Calories` with a capital are the food Calorie. The everyday
"calories" of a diet are kilocalories, so write a food figure as `kcal` or `Cal`;
`2000 calories` is two thousand small calories, about 8 kJ.

```solve
1 calorie in J // 4.18 J
2000 calories in kJ // 8.37 kJ
2000 Calories in kJ // 8,368.00 kJ
```

The calorie is the thermochemical one, exactly 4.184 joules, which is the size
food energy is reckoned in. The slightly larger International Table calorie of
engineering steam tables, 4.1868 joules, is not offered, so a calorie means one
thing.

## BTU and therms

The British thermal unit (`BTU`, or `Btu` as standards bodies write it) is about
the energy that warms a pound of water by one degree Fahrenheit, and it rates
boilers and furnaces. A therm (`therm`, `therms`) is 100,000 BTU and is the unit
many gas bills charge in.

```solve
100000 BTU in kWh // 29.31 kWh
1 therm in BTU // 100,000.00 BTU
45 therms in kWh // 1,318.82 kWh
```

The BTU is the International Table one, exactly 1,055.05585262 joules, and the
therm is 100,000 of those, as the UK and EU therm is. The US therm is built on an
older BTU and is about 0.02% smaller, so a US gas bill converted here reads that
much high.

## Electronvolts

An electronvolt (`eV`) is the energy one electron gains crossing one volt, a
tiny amount that suits atoms and particles. It is exactly 1.602176634 × 10⁻¹⁹
joules, and comes with the prefixes physics uses: `keV`, `MeV` and `GeV`.

```solve
1 eV in J // 1.6e-19 J
13.6 eV in J // 2.18e-18 J
1 MeV in keV // 1,000.00 keV
```

## The boundary

An energy converts only to another energy: `2 kcal * 3 m` and `2 kcal + 3 kg` are
refused by name rather than guessed at. Case matters throughout, so `KCAL` and
`CAL` are names, not units. A BTU per hour, the unit an air conditioner is often
rated in, is a power. Written `BTU/h` it is read as a rate of energy over time,
which converts to another such rate but not to watts:

```solve
12000 BTU/h in kJ/h // 12,660.67 kJ/h
```

Energy that comes from multiplying
other quantities, a power for a time or a charge at a voltage, is on [named
derived units](/syntax/derived-units/) and [electricity](/syntax/electricity/).
