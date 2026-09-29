---
title: "Fuel economy"
description: Converting between miles per gallon and litres per 100 km, which run opposite ways.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Fuel economy says how far a vehicle goes on a given amount of fuel. It is written
two ways that measure the same thing from opposite ends, and converting between
them is not a plain rescale, so the engine handles the turn for you.

Fuel economy is written two ways that mean the same thing: **miles per gallon**
(`mpg`), where a bigger number is better, and **litres per 100 km** (`l/100km`),
where a smaller number is better. One is distance per fuel, the other fuel per
distance, so they are opposites of each other, and converting between them means
taking one over the other, not just rescaling. That is why it needs its own
step, and it is done for you:

```solve
40 mpg in l/100km // 5.88 l/100km
6 l/100km in mpg // 39.20 mpg
30 mpg in km/l // 12.75 km/l
```

Going between two distance-per-fuel forms, `mpg` and `km/l`, is an ordinary
rescale, since both count the same way up; it is only the mpg-to-`l/100km`
pairing that turns over.

## US and imperial gallons

There are two gallons. The US gallon is about 3.79 litres; the imperial gallon,
the one British and Irish fuel economy figures are quoted in, is about 4.55
litres, a fifth larger. The engine has both: `gallon` and `gal` on their own
are the US gallon, and `imperial gallon` is the larger one.

```solve
1 gallon in litres // 3.79 litres
1 imperial gallon in litres // 4.55 litres
1 imperial gallon in gallons // 1.20 gallons
```

So there are two miles per gallon as well. `mpg` on its own is miles per US
gallon. A UK brochure's figure is miles per imperial gallon, and it is written
with the qualifier, before or after: `mpg imperial`, `imperial mpg`, `mpg uk`,
`mpg UK` or `UK mpg`. It converts both ways, like `mpg`:

```solve
35 mpg imperial in l/100km // 8.07 l/100km
35 UK mpg in l/100km // 8.07 l/100km
8.07 l/100km in mpg imperial // 35.00 mpg imperial
50 mpg uk in mpg // 41.63 mpg
```

Because the imperial gallon is larger, the same number of miles per gallon is a
thriftier car in the UK than in the US, and the difference is not small: 35
imperial mpg is 29.14 US mpg. It is the same answer as writing the miles over an
imperial gallon out in full, which also works:

```solve
35 mpg imperial in mpg // 29.14 mpg
50 miles / 1 imperial gallon in l/100km // 5.65 l/100km
```

The boundary: a bare `mpg` stays the US gallon, the convention the engine has
always used, and the engine does not choose a gallon from your locale. A UK
figure typed as plain `mpg` is therefore read as US miles per gallon, so the car
appears to use less fuel than it does (4.70 litres per 100 km rather than 5.65).

```solve
50 mpg in l/100km // 4.70 l/100km
50 mpg uk in l/100km // 5.65 l/100km
```
