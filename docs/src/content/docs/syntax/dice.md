---
title: Dice
description: Random integers in a range.
---

> **Package:** `DICE_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

`roll` gives a random whole number in a range you choose, inclusive of both
bounds, like rolling a die. The result changes on every evaluation, so it is
shown rather than asserted here.

| Expression | Result |
| --- | --- |
| `roll(1, 6)` | an integer from 1 to 6 |
| `roll(1, 100)` | an integer from 1 to 100 |
| `roll between 1 and 6` | the same, written as a phrase |
| `roll from 1 to 6` | the same, written as a phrase |
