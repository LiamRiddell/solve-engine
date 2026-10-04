---
title: "Electricity"
description: Volts, amps, ohms and amp-hours, Ohm's law, and the energy in a battery.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Four quantities describe most everyday electrics. **Voltage** is the push that
drives a current, measured in volts: a phone charger gives 5 V, a car battery
12 V, a UK socket 230 V. **Current** is how much electricity flows, measured in
amperes (amps). **Resistance** is how hard a part makes it for current to flow,
measured in ohms. And **charge** is an amount of electricity, a current kept up
for a time, which is what a battery holds and is rated in amp-hours.

## Volts and amps

A voltage is written `V`, `volt` or `volts`, and a current `A`, `amp`, `amps`,
`ampere` or `amperes`. The prefixes a meter shows are there too: `mV` and `kV`
for thousandths and thousands of a volt, `mA` and `kA` for the amp.

```solve
12 V // 12.00 V
12 volts // 12.00 volts
230 V in kV // 0.23 kV
500 mA in A // 0.50 A
5 amps in mA // 5,000.00 mA
```

## Ohms

A resistance is written `ohm` or `ohms`, or with its symbol `Ω`, and a resistor's
label usually carries a prefix: `kΩ` for thousands of ohms and `MΩ` for millions.
The symbol reaches a line as one of two characters that look the same, the Greek
capital omega (U+03A9, what a keyboard or a character picker gives) and the ohm
sign (U+2126, which a datasheet pasted from a PDF can carry). Both are read as
the ohm, and the lower-case omega `ω` is not.

```solve
10 ohm // 10.00 ohm
10 Ω // 10.00 Ω
4.7 kΩ in ohm // 4,700.00 ohm
1 MΩ in kΩ // 1,000.00 kΩ
```

## Ohm's law

Voltage, current and resistance are tied together: the voltage across a part is
its current times its resistance. That is Ohm's law, and it works in every
direction, so dividing a voltage by a current gives the resistance, and dividing
a voltage by a resistance gives the current. The engine names each answer, and a
voltage times a current is the power in watts.

```solve
12 V / 2 A // 6.00 Ω
2 A * 6 Ω // 12.00 V
12 V / 6 Ω // 2.00 A
2 mA * 4.7 kΩ // 9.40 V
230 V * 13 A // 2,990.00 W
2990 W / 230 V // 13.00 A
```

A quantity named this way is an ordinary one, so `in` converts it to another unit
of the same kind: `12 V / 2 A in kΩ` is 0.006 kilohms.

## Amp-hours and batteries

A charge is a current for a time. One amp for one hour is an **amp-hour** (`Ah`),
and a phone battery is rated in thousandths of one, milliamp-hours (`mAh`). A
current multiplied by a time is named in amp-hours, and a charge over a time
gives the current back.

```solve
3000 mAh in Ah // 3.00 Ah
2 A * 3 h // 6.00 Ah
3 Ah / 6 h // 0.50 A
```

A battery's energy is its charge times its voltage, and that is the figure a
battery is compared on, in watt-hours (`Wh`). A charge written in amp-hours at a
voltage is named in watt-hours whatever its prefix, so a 3,000 mAh phone battery
at 3.7 V holds 11.1 Wh. Dividing a watt-hour energy by a voltage gives the charge
back in amp-hours.

```solve
3000 mAh * 3.7 V // 11.10 Wh
100 Ah * 12 V // 1,200.00 Wh
100 Ah * 12 V in kWh // 1.20 kWh
11.1 Wh / 3.7 V // 3.00 Ah
```

The SI unit of charge is the coulomb, one amp for one second, so an amp-hour is
3,600 coulombs. It is written as a word, `coulomb` or `coulombs`, because `C` is
Celsius. A charge worked out by arithmetic is always named in amp-hours, even
over seconds, so ask for coulombs when that is the unit you want. A charge
written in coulombs at a voltage stays in joules, the energy's own unit.

```solve
1 Ah in coulombs // 3,600.00 coulombs
2 A * 30 s // 0.02 Ah
2 A * 30 s in coulombs // 60.00 coulombs
60 coulombs * 12 V // 720.00 J
```

## The boundary

A charge over a current is a time (how long a battery lasts at a steady draw),
but it is not named as one, in the same way that an energy over a power is not:
both stay as the quotient of the units written. Naming a time from other
quantities is a separate piece of work on [multiplying and dividing
units](/syntax/unit-algebra/).

```solve
3000 mAh / 500 mA // 6.00 mAh/mA
```

`C` stays Celsius, so the coulomb has no symbol. The `as` readouts of [named
derived units](/syntax/derived-units/) (`as W`, `as kWh`) gain no new names for
the ohm, the amp or the amp-hour, because they are matched without regard to
case and `mΩ` and `MΩ` would be one name; `in` converts any of them.
Capacitance (farads) and inductance (henries) are not units here.
