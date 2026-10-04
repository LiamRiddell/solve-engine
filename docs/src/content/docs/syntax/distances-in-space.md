---
title: "Distances in space"
description: The astronomical unit, the light-year and the parsec.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Distances in space are too large for kilometres to read comfortably, so
astronomy has its own lengths. The **astronomical unit** (`AU`) is roughly the
distance from the Earth to the Sun and suits the solar system. The
**light-year** (`ly`) is how far light travels in a year and suits the nearest
stars. The **parsec** (`pc`), about 3.26 light-years, is the one astronomers
measure star distances in. All three are lengths, so they convert to each other
and to kilometres or miles.

```solve
1 AU in km // 149,597,870.70 km
1 AU in miles // 92,955,807.27 miles
5.2 AU in km // 777,908,927.64 km
1 ly in AU // 63,241.08 AU
1 pc in ly // 3.26 ly
```

The astronomical unit is the International Astronomical Union's fixed figure,
exactly 149,597,870,700 metres. The light-year and the parsec are the unit
table's own values.

## The boundary

Only the capitals `AU` are the astronomical unit. The IAU's own lower-case symbol
`au` is not read, because it is also the start of `au pair` and `au revoir`, and a
number in front of it would turn those into a distance.
