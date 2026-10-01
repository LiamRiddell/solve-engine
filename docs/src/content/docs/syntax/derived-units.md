---
title: "Named derived units"
description: Multiplying quantities into a named physical unit like the newton, watt or joule.
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
million and `m` for a thousandth, and `as` asks for any of them. A letter whose
case does not change the prefix may be written in lower case, since after `as`
the name can only be a unit: `as kn` is the kilonewton, `as kj` the kilojoule,
`as kpa` the kilopascal, `as kv` the kilovolt and `as kw` the kilowatt, and `as
mv` the millivolt, the one volt the list spells with an `m`.

```solve
10000 N as kn // 10.00 kN
5000 J as kj // 5.00 kJ
2000 Pa as kpa // 2.00 kPa
2000 V as kv // 2.00 kV
0.5 V as mv // 500.00 mV
2000000 J as MJ // 2.00 MJ
```

Where `m` and `M` would name two different units, the case is the meaning, and
the section on prefixes below says how a spelling that could be either is read.

Every spelling of a quantity takes part, imperial as well as metric, so pounds,
feet and pound-force (`lbf`) compose just as kilograms, metres and newtons do.

```solve
10 lbf * 3 ft // 40.67 J
5 lb * 9.8 m/s^2 // 22.23 N
```

Dividing a power by a voltage gives the **current**, the rate at which electric
charge flows, in amperes (`A`): a 100 watt load on 20 volts draws 5 amps. It
converts to milliamps and kiloamps like any other unit.

```solve
100 W / 20 V // 5.00 A
100 W / 20 V in mA // 5,000.00 mA
2 A * 12 V // 24.00 W
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

The spellings `as` reads, from pico (a trillionth) to peta (a thousand million
million):

| unit | spellings |
| --- | --- |
| newton | `pN`, `nN`, `µN`, `mN`, `N`, `kN`, `MN`, `GN`, `TN`, `PN` |
| joule | `pJ`, `nJ`, `µJ`, `mJ`, `J`, `kJ`, `MJ`, `GJ`, `TJ`, `PJ` |
| watt | `pW`, `nW`, `µW`, `mW`, `W`, `kW`, `MW`, `GW`, `TW`, `PW` |
| watt-hour | `pWh`, `nWh`, `µWh`, `mWh`, `Wh`, `kWh`, `MWh`, `GWh`, `TWh`, `PWh` |
| pascal | `pPa`, `nPa`, `µPa`, `mPa`, `Pa`, `kPa`, `MPa`, `GPa`, `TPa`, `PPa` |
| volt | `mV`, `V`, `kV` |

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

## Speed, acceleration and frequency

A **speed** is a distance per time, such as kilometres per hour. An
**acceleration** is how fast a speed changes, a speed per time: a falling stone
gains 9.81 metres per second every second, written `9.81 m/s^2`, metres per
second squared. A **frequency** is how often something happens per second, in
hertz (`Hz`): 10 Hz is ten times a second.

These combine the way a physics book says they do. An acceleration for a time is
the speed gained; a change of speed over a time is an acceleration; a speed times
a force is a power; and a frequency for a time is a plain count of how many times
it happened.

```solve
9.81 m/s^2 * 3 s // 29.43 m/s
3 s * 9.81 m/s^2 // 29.43 m/s
100 km/h / 10 s // 2.78 m/s²
29.43 m/s / 9.81 m/s^2 // 3.00 s
10 Hz * 2 s // 20
10 m/s * 5 N // 50.00 W
```

The answers convert like any other speed or acceleration. A speed is built in
metres per second, or in the acceleration's own length and time when it was
written in feet or hours, and an acceleration in metres per second squared.

```solve
9.81 m/s^2 * 3 s in mph // 65.83 mph
3 ft/s^2 * 2 s // 6.00 ft/s
100 km/h / 10 s in ft/s^2 // 9.11 ft/s²
```

An acceleration can be written in any length over a time squared, `ft/s^2` or
`km/h^2` as well as `m/s^2`, and they convert into one another. Anything else
asked of one is refused in words: an acceleration is not a force until a mass
multiplies it.

```solve-doc
9.81 m/s² in m/s^2 // 9.81 m/s²
9.81 m/s^2 in ft/s^2 // 32.19 ft/s²
2 kg * 3 ft/s^2 // 1.83 N
9.81 m/s^2 in N // ERROR: an acceleration cannot be converted to a force
```

A frequency is a count per second, so it converts to any count per unit of time
written with a bare slash, and back again.

```solve
10 Hz in /s // 10.00 /s
10 Hz in /min // 600.00 /min
600 /min in Hz // 10.00 Hz
```

A speed is only built this way when one side is already a speed, an
acceleration or a frequency. A distance over a time keeps the units it was
written in, `90 km / 3 days` is a rate in kilometres per day, and a distance
over a speed is a time in the speed's own hours (see
[rates and speeds](/syntax/rates-and-speeds/)).

## The boundary

This works only where the combination makes a named quantity, and multiplying
two unrelated quantities is still reported as a mismatch rather than invented
into a unit. Lengths are the exception that needs no name: a length times a
length is an area and a length times an area is a volume, so `5 m * 3 m` is
`15.00 m²`. Those rules, and rates that cancel against what they are per, are on
[multiplying and dividing units](/syntax/unit-algebra/).

The boundary: the named units are the newton, joule, watt, pascal, volt and
ampere, with the speeds, accelerations and counts above. A combination with no
name among them, such as a kilogram-metre or a momentum (`100 kg * 10 m/s`), is
not shown as a compound unit. Angular speed (`rpm`) and torque are not covered.
