---
title: Randomness
description: "Random helpers and identifiers: uuid, random hex, pick, shuffle and coin."
---

> **Package:** `RANDOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Everyday random helpers: draw an identifier, pick one option out of several,
shuffle a list, toss a coin. It is the companion to the [dice](/syntax/dice/)
page, which covers dice-notation rolls; this is the general pickers.

Because each answer is drawn fresh, the results below change every time the line
runs. Edit one and watch it re-roll, that is the point, so unlike the rest of the
documentation these examples show no fixed answer.

## A unique identifier

`uuid` produces a random version-4 UUID, the `xxxxxxxx-xxxx-4xxx-yxxx-…` form used
as a one-off identifier for a record or a file.

```solve
uuid
```

## Random hex

`random hex N` gives N random hexadecimal digits, handy for a short token or a
throwaway key.

```solve
random hex 8
```

## Picking and shuffling

`pick` chooses one of its options at random; `shuffle` puts a list into a random
order.

```solve
pick("north", "south", "east", "west")
shuffle [1, 2, 3, 4, 5]
```

## A coin toss

`coin` is `heads` or `tails`, an even fifty-fifty.

```solve
coin
```

## Notes

Randomness here comes from the same source the engine's `random()` and dice rolls
already use. `pick` returns whichever option it landed on unchanged, so the
options can be text, numbers or any other value; `shuffle` expects a single list
(a row or column), and keeps its orientation.
