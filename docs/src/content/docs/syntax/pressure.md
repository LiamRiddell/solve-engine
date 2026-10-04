---
title: "Pressure"
description: Pascals, bar, psi, atmospheres and millimetres of mercury, from tyres to blood pressure.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Pressure is a force spread over an area: how hard air presses on a tyre wall, or
blood on an artery. The SI unit is the pascal (`Pa`), one newton on one square
metre, which is small, so everyday figures use a prefix or an older unit. A
weather map reads in hectopascals (`hPa`) or millibars (`mbar`), a tyre gauge in
`psi` or `bar`, and a diving table in atmospheres (`atm`). Each converts to any
other.

```solve
32 psi in bar // 2.21 bar
1 atm in psi // 14.70 psi
1 bar in kPa // 100.00 kPa
1013 hPa in atm // 1.00 atm
30 inHg in hPa // 1,015.92 hPa
```

## Blood pressure, in millimetres of mercury

Blood pressure is read in millimetres of mercury, `mmHg`: the height a column of
mercury would be pushed up. A reading of 120 over 80 is two pressures in mmHg,
and some countries print them in kilopascals instead.

```solve
120 mmHg in kPa // 16.00 kPa
80 mmHg in kPa // 10.67 kPa
760 mmHg in atm // 1.00 atm
```

The millimetre of mercury is its conventional value, exactly 133.322387415
pascals. The torr, a unit of vacuum gauges, is defined differently (an
atmosphere split into 760 parts) and is smaller by less than one part in seven
million, so the two are kept as separate units that agree to any figure a
reading shows.

```solve
120 mmHg in torr // 120.00 torr
```

## The boundary

A pressure converts only to another pressure, so `120 mmHg in kg` is refused by
name. The inch of mercury is `inHg`; `Hg` on its own is also the inch of mercury,
as the unit table spells it, and not a millimetre. A pressure named from a force
over an area is on [named derived units](/syntax/derived-units/).
