---
title: "Multiplying and dividing units"
description: Units multiply, divide and cancel the way numbers do, so areas, running costs and coverage come out in the unit they really have.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

When two quantities are multiplied, their units are multiplied too. A room 5
metres long and 3 metres wide covers 15 **square metres**: a metre times a metre
is a new unit, the metre squared, which measures area. Dividing runs the other
way, so 15 square metres along a 3 metre wall leaves 5 metres. And a unit that
appears on both sides of a division **cancels**, the way a number divided by
itself leaves 1: a price in dollars per kilowatt-hour, multiplied by a number of
kilowatt-hours, leaves dollars.

Solve follows these rules, so an answer comes out in the unit it really has.
Where the units combine into something the engine cannot show, such as a
kilogram times a kilogram, the answer is an error that says so rather than a
number in the wrong unit.

## Areas and volumes

A length times a length is an area, and three lengths multiplied are a volume.
The left operand's unit sets the answer's, the same rule addition follows. An
area or volume the engine works out is printed with a superscript: `m²` is square
metres and `m³` cubic metres.

```solve
5 m * 3 m // 15.00 m²
2 m * 3 m * 4 m // 24.00 m³
5 m * 3 ft // 4.57 m²
5 m2 * 3 m // 15.00 m³
```

A square or cubic unit can be typed with the superscript, with a plain digit
(`m2`), or in words (`square metres`, `sq ft`, `cubic feet`). Every spelling of
one unit is the same unit, so they convert, compare and add together.

```solve
15 m² in ft² // 161.46 ft²
3 m * 2 m in square feet // 64.58 square feet
15 sq ft in m² // 1.39 m²
15 m² + 10 sq ft // 15.93 m²
2 cubic metres in litres // 2,000.00 litres
```

A power can also be written on the unit: `m^2` is square metres. The power
belongs to the unit it is written on, so `5 m^2` is five square metres, the way
a physics book reads it, and not five metres squared, which would be 25 square
metres. To square a whole quantity, put it in brackets.

```solve
5 m^2 // 5.00 m²
10 m^3 in litres // 10,000.00 litres
(3 m)^2 // 9.00 m²
```

## Dividing back down

Dividing an area by a length gives a length: the answer to "how long is a
15 square metre room that is 3 metres wide?". A volume divided by an area is a
length too, and a volume divided by a length is an area. The answer is measured
in the length the area or volume is written in, or in the divisor's when the
area has a name of its own, such as a hectare.

```solve
15 m² / 3 m // 5.00 m
24 m³ / 6 m² // 4.00 m
24 m³ / 6 m // 4.00 m²
1 ha / 50 m // 200.00 m
```

A square root takes an area back to the length it is the square of, and a cube
root does the same for a volume. A power of a half, or of a third, is the same
root written another way.

```solve
sqrt(16 m²) // 4.00 m
cbrt(27 m³) // 3.00 m
(9 m²)^0.5 // 3.00 m
sqrt(1 ha) // 100.00 m
```

## Rates that cancel

A rate is one quantity per one of another: a price per kilogram, a speed in
miles per hour, a paint's coverage in square metres per litre. Multiplying a rate
by the thing it is per cancels that unit and leaves the other, which is how a
unit price and a quantity make a bill.

```solve
6 kWh * $0.30/kWh // $1.80
3 kg * $5/kg // $15.00
2 kW * 3 h * $0.30/kWh // $1.80
60 mph * 2 hours // 120.00 mi
```

A price written straight after an amount belongs to it, so `$5/kg` is one rate
wherever it stands in a line: `3 kg * $5/kg` is fifteen dollars, not fifteen
dollars per kilogram. The single-word rates, such as `mph`, `mpg` and `Mbps`,
cancel in the same way as the ones written with a slash.

Dividing a quantity by a rate for it cancels the other half, and answers how many
of the thing the rate is per: how many litres of paint a wall needs, how long a
journey takes, how much a sum of money buys.

```solve
20 m² / (5 m²/l) // 4.00 l
120 miles / 60 mph // 2.00 h
100 miles / 30 mpg // 3.33 gal
$100 / ($5/kg) // 20.00 kg
```

Two rates that share a unit cancel it between them: an hourly rate times hours
a day is a daily rate, and a speed divided by a fuel use per hour is a distance
per litre.

```solve
$30/hour * 8 hours/day // 240.00 USD/day
(100 km/h) / (10 l/h) // 10.00 km/l
```

## One per something

A plain number divided by a quantity is its reciprocal: how many of something
fit in one of the unit, or how often a thing happens per unit. One divided by
two metres is half of one per metre, written `/m`, the same per-unit rate the
engine uses anywhere a count is per something. It cancels like any other rate,
so multiplying it by a length gives back a plain number. A rate turns over, so
the reciprocal of a speed is the time a kilometre takes, and the reciprocal of
a frequency is its period in seconds.

```solve
1 / (2 m) // 0.50 /m
10 / (5 s) // 2.00 /s
1 / (2 m) * 4 m // 2
1 / (50 Hz) // 0.02 s
1 / (2/week) // 0.50 week
```

The brackets matter. A fraction written in front of a unit is that much of the
unit, the way a recipe or a timesheet reads it, so `1/2 hour` is half an hour and
`3/4 cup` three quarters of a cup. Bracket the quantity to ask for the
reciprocal instead.

```solve
1/2 hour // 0.50 hour
3 / 4 cup // 0.75 cup
1 / (2 hour) // 0.50 /hour
```

A temperature has no reciprocal: it is measured from a zero point of its own,
so there is no "per degree" to show, and it is refused by name.

```solve-doc
1 / (20 C) // ERROR: A number divided by a temperature in C has no unit: a temperature is measured from a zero point of its own, so there is no "per degree" to show it in.
```

## Worked through

Paint for one wall, two coats, from a tin that covers 12 square metres a litre:

```solve-doc
wall = 4 m * 2.5 m // 10.00 m²
coats = 2 // 2
paint = wall * coats / (12 m²/l) // 1.67 l
```

What a 3 kW kettle costs to run for twenty minutes at 28p a kilowatt-hour. A
power for a time is an energy, named here in kilowatt-hours (see
[named derived units](/syntax/derived-units/)):

```solve-doc
kettle = 3 kW // 3.00 kW
used = kettle * 20 min // 1.00 kWh
cost = used * £0.28/kWh // £0.28
```

## What has no unit

Only lengths square into a new unit, and only up to a volume. A mass times a
mass, a time times a time, or money times money has no unit the engine can show;
neither has an area times an area, which would be a metre to the fourth power.
A rate divided by what it is per, such as a speed divided by a time, is a rate
of a rate. Each is refused by name. A like product used to keep the left
operand's unit, so `2 kg * 3 kg` was reported as 6 kg, a confident answer in the
wrong unit.

```solve-doc
2 kg * 3 kg // ERROR: A quantity in kg times one in kg has no unit: mass times mass is not a unit. Lengths multiply into an area or a volume, and no other quantity squares into one.
$5 * $3 // ERROR: A quantity in USD times one in USD has no unit: money times money is not a unit. Lengths multiply into an area or a volume, and no other quantity squares into one.
5 m2 * 3 m2 // ERROR: A quantity in m2 times one in m2 has no unit: lengths multiply into an area or a volume, and a product of more than three lengths is not a unit.
(100 km/h) / (2 h) // ERROR: A quantity in km/h divided by one in h has no unit: nothing cancels, and km/h per h is a rate of a rate, which is not a unit.
sqrt(5 m) // ERROR: sqrt: a quantity in m has no square root with a unit; only an area has a length as its root.
```

Money times a count is the exception that stays. Thirty dollars times four days
is the cost of four days at thirty dollars a day, because one side is money and
the other only says how many.

```solve
$30 * 4 days // $120.00
```

## The boundary

This covers the units the engine already holds: lengths, areas and volumes,
rates of one unit per another, and the named physical units on the
[derived units](/syntax/derived-units/) page. It is not a general algebra of
units, so a product such as a kilogram-metre, or a metre to the fourth power,
is refused rather than shown.

- A reciprocal is a per-unit rate (`/s`), not a named unit, so ten per second is
  `10.00 /s` rather than ten hertz, and the two do not convert into each other.
- A rate cancels against the quantity it meets. `$0.30/kWh * 2 kW * 3 h` is
  refused, because the price meets a power before the time has made it an
  energy; write the energy first, as in `2 kW * 3 h * $0.30/kWh`.
- A single capital letter after a slash, as in `$0.50/W`, is read as a variable
  called `W`, since `N` and `W` are common names for a count. Write the unit as a
  word, `$0.50 per watt`.
- There is no unit for an amount of substance (`mol`), so gas-law formulas such
  as PV = nRT are not yet available.
