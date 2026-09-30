---
title: "Defining your own units"
description: Naming a unit the engine does not ship, in terms of one it does.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

When the unit you want to work in is not one the engine ships, you can define it
yourself in terms of one it does. A sprint is two weeks; a story point is four
hours. Once named, it behaves like any built-in unit on the lines that follow.

A document can name a unit the engine does not ship, the same way it can define
a function. Write `1 <name> = <quantity> <unit>`, and the name works on every
line below it.

```solve
1 sprint = 2 weeks // sprint defined
6 sprints in days // 84 days
1 story point = 4 hours // story point defined
13 story points // 52 hours
```

The base is always a real unit, so a defined unit inherits that unit's
dimension. `6 sprints in days` converts, and `6 sprints in kg` is refused the
same way `2 weeks in kg` is: a duration is not a mass.

Plurals and multi-word names both work, and only the natural `1 name = ...`
shape defines a unit, so `2 x = 10` is still an equation. A definition holds for
the document that wrote it and nowhere else, and a later line redefining the same
name replaces the earlier one.

## Converting into a defined unit

A defined unit is a target as well as a source. `84 days in sprints` asks how
many sprints make 84 days, and the answer is counted in sprints: the engine
converts into the unit the sprint is defined in, then counts how many of the
definition fit. The quantity underneath is still twelve weeks, so it converts on
from there like any other.

```solve
1 sprint = 2 weeks // sprint defined
84 days in sprints // 6 sprints
3 weeks in sprints // 1.50 sprints
```

A definition that is exactly one of a unit is a new name for it rather than a
new size, and a quantity written in the name is shown under it. A soldier's
`click` is a kilometre:

```solve
1 click = 1 km // click defined
3 clicks // 3.00 clicks
3 clicks in m // 3,000.00 m
5 km in clicks // 5.00 clicks
```

The boundary: the plural is found by dropping one trailing `s`, so `sprints`
reaches `sprint`, but a plural made any other way (`1 Woche = 1 week`, then `3
Wochen`) is not recognised, and the line is refused as an undefined name. Define
the plural as its own name when it is not an `s`. A package can declare words
for units the same way for every document at once; see
[words for units](/packages/unit-aliases/).
