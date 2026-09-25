---
title: Geometry
description: "Area, perimeter and volume of the common shapes, from their dimensions."
---

> **Package:** `GEOMETRY_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Work out the size of a shape from its measurements: the **area** it covers, the
**perimeter** around its edge, the **volume** it holds, or its **surface area**.
Name the measure, the shape, and the shape's dimensions, and the formula is
applied for you, no need to remember whether it was `πr²` or `2πr`.

## Flat shapes

```solve
area of circle radius 5 // 78.54
circumference of circle radius 5 // 31.42
area of square side 4 // 16
perimeter of square side 4 // 16
area of triangle base 3, height 4 // 6
```

A shape with two dimensions takes them as a pair, separated by a **comma**:

```solve
area of rectangle width 4, height 6 // 24
perimeter of rectangle width 4, height 6 // 20
```

The comma matters. Without it, `4 height` reads as a number times a value called
`height` (the ordinary "4x means 4 times x" rule), so the comma is what keeps the
two measurements apart. It also means the dimension words (`width`, `height`,
`radius`, ...) stay ordinary words you can still use as names elsewhere.

## Solid shapes

```solve
volume of sphere radius 3 // 113.10
surface area of sphere radius 3 // 113.10
volume of cube side 2 // 8
volume of cylinder radius 2, height 5 // 62.83
volume of cone radius 2, height 6 // 25.13
```

## Dimensions with units

A dimension can carry its unit, and the answer then comes out in the unit its
measure has. A perimeter is a length, so it stays in metres. An area is a length
times a length, so it is in **square metres** (m²): the size of a square one
metre on each side. A volume is three lengths multiplied, so it is in **cubic
metres** (m³). This is the answer the formula gives when you write it out by
hand, `pi * (5 m)^2`, and it converts the way any area or volume does.

```solve
area of circle radius 5 m // 78.54 m²
area of circle radius 5 m in cm² // 785,398.16 cm²
volume of sphere radius 2 m // 33.51 m³
perimeter of circle radius 5 m in cm // 3,141.59 cm
area of rectangle width 3 m, height 4 m // 12.00 m²
volume of cube side 2 ft // 8.00 ft³
```

When the dimensions are in different units, they are all read in the unit of
the first one written, so a width in metres and a height in centimetres give
square metres. A dimension with no unit beside one with a unit is read in that
unit, the way a bare number in a [list of quantities](/syntax/statistics/) is.
A length with no square or cube of its own, such as the furlong, answers in
square or cubic metres, as `(5 furlong)^2` does.

```solve
area of rectangle width 3 m, height 400 cm // 12.00 m²
area of rectangle width 300 cm, height 4 m // 120,000.00 cm²
area of rectangle width 3 m, height 4 // 12.00 m²
area of square side 2 furlong // 161,874.26 m²
```

An area is not a length, so converting one to centimetres rather than square
centimetres is refused. A dimension that is not a length at all, a mass, a
duration or an amount of money, is refused by name rather than read as a number.

```solve
area of circle radius 5 m in cm // an area cannot be converted to a length
area of circle radius 5 kg // a radius is a length, not a mass: give it in a unit of length, such as m or ft
area of rectangle width $3, height 4 m // a width is a length, not money: give it in a unit of length, such as m or ft
```

## The shapes and their dimensions

- **circle**: `radius` (area, perimeter / circumference)
- **square**: `side` (area, perimeter)
- **rectangle**: `width`, `height` (area, perimeter)
- **triangle**: `base`, `height` (area)
- **sphere**: `radius` (volume, surface area)
- **cube**: `side` (volume, surface area)
- **cylinder**: `radius`, `height` (volume, surface area)
- **cone**: `radius`, `height` (volume)

Dimensions written as plain numbers give a plain number, as in the first
examples on this page; dimensions with units give a length, an area or a volume.
A measure a shape does not define, or a missing dimension, is reported as an
error naming what it needed rather than a wrong number.
