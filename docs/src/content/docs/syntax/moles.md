---
title: "Moles"
description: The mole and the millimole, chemistry's count of particles.
---

> **Package:** `UOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

A mole is chemistry's way of counting particles that are far too small and too
many to count one by one: one mole is 6.02214076 × 10²³ of them, whether atoms,
molecules or ions. A chemistry answer is often in moles (`mol`), and a blood test
reports some results in thousandths of one, millimoles (`mmol`). The two convert
to each other and add together.

```solve
1 mol in mmol // 1,000.00 mmol
250 mmol in mol // 0.25 mol
2 mol + 500 mmol // 2.50 mol
```

## The boundary

The mole is a conversion unit only. Turning moles into grams needs the mass of
one mole of the particular substance (its molar mass), which the engine does not
know, so a mole does not convert to a mass, and multiplying it by other
quantities is refused rather than invented into a compound unit.

```solve-doc
1 mol in g // ERROR: an amount of substance cannot be converted to a mass
2 mol * 3 kg // ERROR: amount of substance and mass cannot be multiplied
```

It is left out of the dimensional arithmetic that names a newton or a watt (see
[named derived units](/syntax/derived-units/)), which tracks mass, length, time
and current; the amount of substance is a fifth base quantity outside those, and
no named unit the engine produces is made from it. The word `mole` is not read as
the unit, since it is also an animal, a spy and a mark on the skin.
