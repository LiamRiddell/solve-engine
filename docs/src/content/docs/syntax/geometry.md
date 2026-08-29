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

## The shapes and their dimensions

- **circle**: `radius` (area, perimeter / circumference)
- **square**: `side` (area, perimeter)
- **rectangle**: `width`, `height` (area, perimeter)
- **triangle**: `base`, `height` (area)
- **sphere**: `radius` (volume, surface area)
- **cube**: `side` (volume, surface area)
- **cylinder**: `radius`, `height` (volume, surface area)
- **cone**: `radius`, `height` (volume)

Dimensions are plain numbers here (this does not yet carry units through to a
squared or cubed result). A measure a shape does not define, or a missing
dimension, is reported as an error naming what it needed rather than a wrong
number.
