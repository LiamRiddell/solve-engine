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

## Rolls that stay put

A roll that changes every time is right for a game, but a note that records a
roll, or a worked example that uses one, needs it to stay the same. A `random
seed` line anywhere in the note makes every roll in it repeatable: the same seed
always gives the same rolls, on every run and every machine. Each line keeps its
own roll, so editing one line re-rolls only that line, and two identical lines
still roll separately.

```solve-doc
random seed 42
roll(1, 6) // 1
roll(1, 6) // 2
roll between 1 and 100 // 15
```

Change the seed for a different set. See [randomness](/syntax/random/) for the
other draws a seed covers, and for what a seed does not promise.
