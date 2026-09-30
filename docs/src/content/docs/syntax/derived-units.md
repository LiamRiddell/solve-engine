---
title: "Named derived units"
description: Multiplying quantities into a named physical unit like the newton, watt, joule or ohm.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Many physical quantities are really other quantities multiplied together. A
**force** is a mass times an acceleration; **power** is voltage times current;
**energy** is power times time, or a force times a distance. When you multiply
two quantities, the engine tracks what their units combine into, and when the
result is one of these named quantities, it shows it by its name:

```solve
70 kg * 9.81 m/s^2 as N // 686.70 N
230 V * 13 A as W // 2,990.00 W
50 N * 4 m as J // 200.00 J
2000 W * 3 hours as kWh // 6.00 kWh
```

`N` is the newton (force), `W` the watt (power), `J` the joule (energy), and
`kWh` the kilowatt-hour (energy again, the unit an electricity bill uses).
Writing `as N` asks for the answer in that unit; the engine also names the result
on its own when you leave the `as` off. Dividing names a result the same way: an
energy over a time is a power, and a force over an area is a **pressure**, in
pascals (`Pa`).

```solve
100 J / 5 s // 20.00 W
200 N / 2 m² // 100.00 Pa
100 Pa * 2 m² // 200.00 N
```

The named units take the usual metric prefixes, `k` for a thousand, `M` for a
million and `m` for a thousandth, and `as` asks for any of them. After `as` the
name may be written in lower case, since there it can only be a unit: `as kn` is
the kilonewton, `as kj` and `as mj` the kilojoule and the megajoule, `as kpa` and
`as mpa` the kilopascal and the megapascal, `as kv` and `as mv` the kilovolt and
the millivolt, and `as kw` and `as mw` the kilowatt and the megawatt.

```solve
10000 N as kn // 10.00 kN
2000000 J as mj // 2.00 MJ
5000 J as kj // 5.00 kJ
3000000 Pa as mpa // 3.00 MPa
2000 Pa as kpa // 2.00 kPa
2000 V as kv // 2.00 kV
0.5 V as mv // 500.00 mV
2000000 W as mw // 2.00 MW
```

The boundary: `as` reads the name without its case, so it cannot tell `m` (a
thousandth) from `M` (a million). Each name stands for the one unit in the list
above, so `as mw` is always the megawatt and `as mv` always the millivolt. For a
unit outside the list, such as the milliwatt, convert with `in`, which keeps the
case as written:

```solve
5 mW in mW // 5.00 mW
```

Every spelling of a quantity takes part, imperial as well as metric, so pounds,
feet and pound-force (`lbf`) compose just as kilograms, metres and newtons do.

```solve
10 lbf * 3 ft // 40.67 J
5 lb * 9.8 m/s^2 // 22.23 N
```

An acceleration is written in metres per second squared, `m/s^2` or `m/s²`, and
that is the one acceleration unit the engine holds. It converts to itself, and
anything else asked of it is refused in words: an acceleration is not a force
until a mass multiplies it.

```solve-doc
9.81 m/s² in m/s^2 // 9.81 m/s²
9.81 m/s^2 in N // ERROR: an acceleration cannot be converted to a force
```

A power used for a time of a minute or more is named in watt-hours, with the
power's own prefix: a 2 kW heater for three hours uses 6 kilowatt-hours, the
figure a bill charges for, rather than 21,600,000 joules. Dividing such an energy
by a time gives the power back in the matching watt. A power for seconds stays in
joules, the energy's own scale.

```solve
2 kW * 3 h // 6.00 kWh
100 W * 3 hours // 300.00 Wh
6 kWh / 3 h // 2.00 kW
100 W * 30 s // 3,000.00 J
```

The electrical quantities are named the same way. A voltage over a current is a
**resistance**, in ohms (`Ω`); a voltage over a resistance, or a power over a
voltage, is a current in amps (`A`); and a current for a time is a **charge**,
named in amp-hours (`Ah`), the unit a battery is rated in. A charge in amp-hours
at a voltage is the battery's energy, named in watt-hours.
[Electricity](/syntax/electricity/) walks through each.

```solve
12 V / 2 A // 6.00 Ω
12 V / 6 Ω // 2.00 A
2 A * 3 h // 6.00 Ah
3000 mAh * 3.7 V // 11.10 Wh
```

A **prefix** in front of a unit scales it by a power of ten: `k` (kilo) is a
thousand, `m` (milli) a thousandth, `M` (mega) a million, `µ` (micro) a millionth.
`as` takes any of them before the newton, joule, watt, watt-hour and pascal, and
the millivolt and kilovolt beside the volt. The case of a prefix letter is part
of its meaning, so `mW` (a milliwatt) and `MW` (a megawatt) are a billion times
apart, and `pW` (pico) and `PW` (peta) further still. `as` reads the unit exactly
as written, just as `in` does:

```solve
5 W as mW // 5,000.00 mW
5 W in mW // 5,000.00 mW
5 MW as mW // 5,000,000,000.00 mW
1 W as pW // 1,000,000,000,000.00 pW
```

A spelling in the wrong case is refused rather than read as one of the two it
could be. `as mw` names no unit, since it could be the milliwatt or the megawatt,
and `as MV` is not the millivolt, whose prefix is the lower-case `m`. A letter
that is not a prefix carries no such meaning, so `as n` is still the newton and
`as KWH` the kilowatt-hour.

```solve-doc
5 W as mw // ERROR: "as mw" could be "as mW" or "as MW": write the unit with its prefix in its own case (m is milli, M is mega, p is pico, P is peta)
1 V as MV // ERROR: "as MV" is not a unit: the one spelled alike is "as mV", whose prefix is written in the other case (m is milli, M is mega, p is pico, P is peta)
10 N as n // 10.00 N
```

This works only where the combination makes a named quantity, and multiplying
two unrelated quantities is still reported as a mismatch rather than invented
into a unit. Lengths are the exception that needs no name: a length times a
length is an area and a length times an area is a volume, so `5 m * 3 m` is
`15.00 m²`. Those rules, and rates that cancel against what they are per, are on
[multiplying and dividing units](/syntax/unit-algebra/).

The boundary: the named units are the newton, joule, watt, pascal, volt, ohm,
ampere and amp-hour. A combination with no name among them, such as a
kilogram-metre, is not shown as a compound unit, and neither is a time worked out
from other quantities, so an energy over a power stays `kWh/kW`. The mole is not
part of this arithmetic at all (see [moles](/syntax/moles/)).
