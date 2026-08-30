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
