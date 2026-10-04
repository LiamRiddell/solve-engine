---
title: Custom as converters
description: Add a target for the 'as' conversion form, a pure function from one value to another.
---

The `as` form, `255 as hex`, `50% as decimal`, converts a value to a named form.
A package adds its own targets through `asConverters`, a flat map from a name to a
pure function. It is the simplest extension point there is: no parselet, no token,
no index to allocate.

## The shape

```ts
asConverters?: Record<string, (value: Value, context?: LineExecutionContext) => Value>;
```

Each handler takes the value on the left of `as` and returns the converted one.
The optional `context` is the same per-line execution context a
[plugin function](/packages/functions-and-operators/#the-plugin-function)
receives. A converter that reads a date takes the engine's calendar backend
from it, `calendarOf(context)` from `solve-engine/engine`, so `<date> as
weekday` answers as the engine's own date arithmetic would; a converter that
needs nothing from it leaves it out, as `tally` does below. That is the whole
contract. Here is a package that adds a `tally` target, which writes a small
count as tally marks in groups of five:

```ts
import type { IEnginePackage } from "solve-engine";
import { stringValue, type Value } from "solve-engine/vm";

export const tallyPackage: IEnginePackage = {
  name: "tally-marks",
  asConverters: {
    tally: (value: Value) => {
      const n = value.toNumber();
      // Tally marks are for small whole counts; anything else passes through.
      if (!Number.isInteger(n) || n < 0 || n > 100) return value;
      return stringValue("|".repeat(n).replace(/(\|{5})(?=\|)/g, "$1 "));
    },
  },
};
```

`7 as tally` now reads `||||| ||`. No lexer change is needed: the `as` parselet
accepts any bare word after `as` and reads its text, so the name is claimed the
moment you register it.

Pick a name no built-in package registers. The converter registry is shared by
every engine in the process, so a package that registered `roman`, which the
built-in numerals package already answers (`10 as roman` reads `X`), would
replace the built-in converter for every engine, not only its own, with a
warning that the later registration wins. Replacing a built-in on purpose is
possible, and is then a decision to name as one in your package's own
documentation.

## `in` reaches it too

A reader who writes `7 in tally` means the same thing, and gets it: before the
line is parsed, `in` followed by the name of a registered converter is rewritten
to `as`, the way `255 in hex` has always reached the built-in `hex`. Without that,
`in` is unit conversion, which took the word as a unit and labelled the number
with it (`7.00 tally`); a word that is neither a unit nor a converter is now
refused there by name.

Two limits keep the rewrite from shadowing anything:

- **Only `in`, not `to`.** A word after `to` is a percentage change to a
  variable, `start to n`, and a converter is often named like one (the derived
  units register `N`, `V` and `W`, which `n`, `v` and `w` reach), so `to` keeps
  its reading.
- **Only an ordinary word.** A name the lexer reads as a unit keeps its unit
  meaning after `in`: the datetime package's `month` converter does not take
  `5 hours in month` away from unit conversion. Pick a name that is not a unit,
  as `tally` is not.

The rewrite asks the same registry `as` asks, so `in` reaches exactly the
converters `as` does. A normaliser rule of your own can ask it too: a rule's
`match` is handed the engine's environment as its third argument, and
`environment.asConverters.match(word)` says whether a word names one of this
engine's converters.

## Names and their case

A name is matched without regard to case, so `7 as TALLY` and `as Tally` reach
`tally`, with one exception: a name you register with capitals is also kept
exactly as you spelled it, and the target the reader typed is tried in that
spelling first. That is what lets a unit's prefix, which is carried by its case,
survive the lookup. The derived units register `mW` (the milliwatt) and `MW` (the
megawatt) side by side, and `as mW` and `as MW` reach different converters.

When two of your names differ only in case, their shared lower-case spelling
belongs to neither: `as mw` is refused by name (`AS_CONVERTER_AMBIGUOUS_CASE`)
rather than read as one of them. When only one is registered, the lower-case
spelling reaches it, unless reading it that way would change the case of a prefix
letter (`m` and `M`, `p` and `P`): `as MV` is refused
(`AS_CONVERTER_PREFIX_CASE`) rather than read as the millivolt. `in` rewrites to
`as` only for a name that matches cleanly, so `in MV` stays a unit conversion and
is refused there as a unit the table does not spell.

A name registered in lower case alone behaves exactly as it always has. Register
a lower-case name and a capitalised one for the same word (`zu` and `Zu`) and it
is the ordinary collision: a warning, and the last registration wins.

## It must be pure and synchronous

A converter is a plain function called during evaluation, so it cannot await. For
a conversion that reaches the network (a live rate, say), use an
[async data source](/guide/async-data-sources/) instead, not a converter.

## Be lenient about the input

The engine checks for a faulted operand before it calls you, so you never see an
error value. But you may see a value of a type you did not expect: `7 as tally`
is a number, `"x" as tally` is a string. Prefer returning the value unchanged over
throwing, the way the colour package's format converters pass a non-colour
straight through. A converter that throws takes the line down; one that declines
leaves the reader's other lines working.

## Built-in names are reserved

The built-in targets (`hex`, `decimal`, `fraction`, `percent`, `binary`, `octal`,
and the rest) are matched while parsing and lower to dedicated opcodes, so a
package cannot shadow them here. Any other name, including yours, resolves through
the converter registry at run time; an unregistered one surfaces as a runtime
error, not a parse error. Registering a name another package already took warns
rather than throws, and the last registration wins.

## One engine's converters

The registry belongs to the engine the package is registered on: it is held on
the engine's context, `engine.getContext().asConverters`. A package passed to
one engine answers `as roman` there and nowhere else, and unregistering it from
that engine leaves another engine holding the same package untouched. Two
engines that register different packages under one converter name each keep
their own.

The boundary: the module-level `registerAsConverter`, `resolveAsConverter`,
`matchAsConverter` and the `asConverterRegistry` map still exist, deprecated,
so existing imports compile. They write and read a registry no engine consults,
so a converter registered through them answers nowhere; declare it in
`asConverters` instead. They are removed in 3.0.
