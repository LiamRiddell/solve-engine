---
title: "Converting units"
description: Turning a quantity from one unit into another with to, in and into.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Converting a quantity means writing the same amount in a different unit: five
kilometres as miles, a hundred centimetres as metres, a temperature in Celsius
as Fahrenheit. The amount does not change, only the unit it is expressed in.

`to`, `in` and `into` all convert.

```solve
5 km to miles // 3.11 miles
100 cm into m // 1.00 m
1 hour to minutes // 60 minutes
72F to C // 22.22 C
20C in F // 68.00 F
```

A conversion between two different dimensions has no answer, so it is refused
rather than guessed. The message names the dimensions rather than the units, so
`1 hour in metres` reports *a duration cannot be converted to a length* and
`5 kg in m` reports *a mass cannot be converted to a length*. Combining two
different dimensions is refused the same way: `5 kg + 3 m` reports *mass and
length cannot be added*.

Only a number or a quantity has an amount to convert. A bracketed list or a
piece of text does not, so converting one is refused rather than answered as
zero of the unit:

```solve-doc
(1, 2) in miles // ERROR: A bracketed list has no single amount to convert to miles: only a number or a quantity can be converted.
```

## Units written in more than one word

Some units are named in two or three words, or with a hyphen: a nautical mile, a
square foot, a cubic metre, an imperial gallon, a light-year. Each reads as the
one unit it names, after an amount or after the conversion word.

```solve
5 km in nautical miles // 2.70 nautical miles
1 nautical mile in km // 1.85 km
5 cubic metres in litres // 5,000.00 litres
3 imperial gallons in litres // 13.64 litres
10 US fluid ounces in ml // 295.74 ml
2 troy ounces in g // 62.21 g
```

The spellings are the unit table's own, so nothing is guessed at: the words are
separated the way the table writes them, one space, or a hyphen in
`light-years`, and a spelling the table does not carry stays unread. The one
allowance is a plural. A few table entries have only the singular (`troy ounce`,
`watt-hour`), and the plural a reader writes reads as that unit. A symbol takes
no plural, so `kW h` is the kilowatt-hour and `kW hs` is not a unit.

## Temperatures, with or without the degree sign

`°C` and `°F` read as the units they obviously are, which is what a phone
keyboard, a weather app and a recipe all write. The precomposed `℃` and `℉`
that some keyboards emit read the same way, and `°K` is kelvin, which has no
degree sign of its own.

```solve
20°C in F // 68.00 F
100°F in C // 37.78 C
180°C in gas mark // gas 4
37°C // 37.00 °C
```

The scale letter is what makes it a temperature, so the bare symbol is still an
angle:

```solve
90° // 90.00 degrees
```

Every spelling of the same question agrees, so use whichever you have to hand:

```solve
20 C in F // 68.00 F
20 degrees C in F // 68.00 F
20° C in F // 68.00 F
```

The boundary is the symbol forms only. `C` is Celsius, and no ordinary word is
claimed as a unit: the cooking cup is spelled `cup`, not `c`, which is not a unit
at all. The case sensitivity of the unit table is unchanged.

```solve
1 cup in ml // 236.59 ml
```

## Inches, where the abbreviation is also the word for converting

`in` is how the engine spells the conversion itself, so it cannot simply be a
unit as well: `12 in ft` has to keep meaning "twelve, in feet". The word is read
as inches where there is plainly nothing to convert into, which is at the end of
a line, before an operator, or before a second `in` or a `to`.

```solve
12 in in cm // 30.48 cm
2 in + 3 in // 5.00 in
12 in to cm // 30.48 cm
```

Everywhere else it is still the preposition, including when the thing being
converted into is itself inches:

```solve
3 ft in in // 36.00 in
```

The full spellings never have to be reasoned about at all, so they are the safer
thing to write in a document somebody else will read:

```solve
12 inches in cm // 30.48 cm
1 inch in mm // 25.40 mm
```
