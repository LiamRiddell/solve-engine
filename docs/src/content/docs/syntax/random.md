---
title: Randomness
description: "Random helpers and identifiers: uuid, random hex, pick, shuffle and coin."
---

> **Package:** `RANDOM_PACKAGE`. Registered by `createEngine()`; for a slimmer engine, register it explicitly (see [choosing packages](/getting-started/installation/)).

Everyday random helpers: draw an identifier, pick one option out of several,
shuffle a list, toss a coin. It is the companion to the [dice](/syntax/dice/)
page, which covers `roll`, a random integer in a range; these are the
general-purpose pickers.

Because each answer is drawn fresh, the results below change every time the line
runs. Edit one and watch it re-roll, that is the point, so these examples show no
fixed answer. A seed makes them repeatable; see
[the same draws every time](#the-same-draws-every-time) below.

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

## The same draws every time

A random draw that changes on every run cannot be checked, shared or written
down. A **seed** fixes that: it is a starting value for the generator, and the
same seed always produces the same draws, on every run and every machine. Write
`random seed` and any number or word as a line anywhere in the note, and every
draw in the note becomes repeatable.

```solve-doc
random seed 42
uuid // 3735de41-7ba2-430d-8b81-afba841149a5
random hex 8 // 8fc405d9
pick("north", "south", "east", "west") // north
shuffle [1, 2, 3, 4, 5] // [2, 1, 5, 3, 4]
coin // tails
```

Each line draws from its own stream, worked out from the seed and from what the
line says, so a draw changes only when its own line is edited or the seed
changes. Adding or editing other lines leaves it where it was, and two lines
written the same way still draw separately. Change the seed to get a different,
equally repeatable set. A program embedding the engine can seed it the same way
with `createEngine({ random: { seed: 42 } })`; a `random seed` line in the note
takes precedence.

The boundary: a seed makes draws repeatable, not secret. The generator is built
to look random to a reader, not to resist someone trying to predict it, so a
seeded `uuid` or `random hex` is not suitable as a password or a security token.

## Notes

Randomness here comes from the same source the engine's `random()` and dice rolls
already use. `pick` returns whichever option it landed on unchanged, so the
options can be text, numbers or any other value; `shuffle` expects a single list
(a row or column), and keeps its orientation.
