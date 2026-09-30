---
title: Words for units
description: Give a word the meaning of a unit the engine already has, so a package can read another language's or another trade's names for units.
---

A unit alias is a second name for a unit the engine already knows: `Meile` for
the mile, `Tage` for days, `furlongs` for a racing crowd that writes it that way.
A package declares its aliases in `unitAliases`, a flat map from each word to the
unit it means. The engine then reads the word wherever it reads a unit, and
answers under the word the reader wrote, while the quantity itself stays in the
unit it stands for, so it converts and adds exactly as that unit does.

This is the extension point for a language package: a German package can say
that `Meile` is a mile without teaching the engine a new unit, and without the
reader's `5 km in Meile` turning into an answer in `mile`.

## The shape

```ts
unitAliases?: Readonly<Record<string, string>>;
```

Each key is a word as a reader writes it; each value is a unit the engine reads
on its own. Here is a package that reads four German words:

```ts
import { createEngine, type IEnginePackage } from "solve-engine";

export const germanUnits: IEnginePackage = {
  name: "german-units",
  engineVersion: "^2.0.0",
  unitAliases: { Meile: "mile", Meilen: "miles", Tage: "days", Stunden: "hours" },
};

const engine = createEngine({ extraPackages: [germanUnits] });
```

With it registered, each line below answers as shown. The table is proven: a spec
evaluates every row against this package, so it cannot drift from the engine.

| Typed | Answer |
| --- | --- |
| `2 Meile` | `2.00 Meile` |
| `2 Meile in km` | `3.22 km` |
| `5 km in Meile` | `3.11 Meile` |
| `5 km to Meilen` | `3.11 Meilen` |
| `3 Tage` | `3 Tage` |
| `3 Tage in hours` | `72 hours` |
| `72 Stunden in Tage` | `3 Tage` |
| `5 km in Meile to 4 dp` | `3.1069 Meile` |
| `5 kg in Meile` | refused |

## Where an alias is read

An alias is read in the two places a unit is: straight after a value (`2 Meile`,
`(1 + 1) Meile`) and as the target of `in`, `into` or `to` (`5 km in Meile`).
Anywhere else it is the ordinary word it is, so a sentence that happens to
contain `Meile` is not rewritten, and `Meile` alone on a line is an undefined
name, as `mile` alone would be a unit with no amount.

The answer is written under the alias, counted in it: `3.11 Meile`. The number
behind it is a quantity in miles, so `x = 5 km in Meile` followed by `x in km`
answers `5.00 km`, and `5 kg in Meile` is refused, a mass being no distance.

## The contract

- **A key is matched exactly as written.** Units are case-sensitive in this
  engine (`C` is Celsius, `c` a cup), and so are aliases. Nothing is guessed for
  a plural either, since a plural in another language is rarely an added `s`:
  list each form a reader writes, `Meile` and `Meilen`.
- **A key must be a plain word.** A word the engine already reads as something
  else, a unit (`mile`), a keyword (`in`), a function (`sqrt`) or more than one
  word, is refused at registration with `PLUGIN_UNIT_ALIAS_UNREACHABLE`, because
  the alias could never be read.
- **A value must be a unit the engine reads on its own**: a single unit word or
  symbol (`mile`, `days`, `kg`). Anything else is refused at registration with
  `PLUGIN_UNIT_ALIAS_TARGET_UNKNOWN`.
- **The document has the last word.** A unit the document defines for itself
  (`1 Meile = 2 km`) means what the document says, on that document's lines.
- **Two packages may alias one word.** It is a compatibility warning, the later
  registration is in force, and unregistering it hands the word back to the
  earlier one. Unregistering the only package that declared a word removes it.
- **Per engine.** An alias belongs to the engine its package is registered on,
  and another engine in the same process does not read it.

## The boundary

An alias names a whole unit. Arithmetic on an aliased quantity answers in the
unit it stands for, since a computed value is a new quantity: `2 Meile * 2` is
`4.00 mile`, and `2 Meile + 3 km` is `3.86 mile`. Rounding to a number of places
keeps the name, as the table shows. An alias is a single word, not a phrase, and
it is not read inside a compound unit (`Meile/h`); a rate is written with the
unit's own name.

This is the mechanism a language pack is built on, not a word list: the engine's
own German and French packs do not yet declare unit aliases, and a document can
still name its own units, see [custom units](/syntax/custom-units/), including as
the target of a conversion.
