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
needs nothing from it leaves it out, as `roman` does below. That is the whole
contract. Here is a package that adds a `roman` target:

```ts
import type { IEnginePackage } from "solve-engine";
import { stringValue, type Value } from "solve-engine/vm";

export const romanPackage: IEnginePackage = {
  name: "roman",
  asConverters: {
    roman: (value: Value) => stringValue(toRomanNumeral(value.toNumber())),
  },
};
```

`10 as roman` now reads `X`. No lexer change is needed: the `as` parselet accepts
any bare word after `as` and reads its text, so the name is claimed the moment you
register it.

## `in` reaches it too

A reader who writes `10 in roman` means the same thing, and gets it: before the
line is parsed, `in` followed by the name of a registered converter is rewritten
to `as`, the way `255 in hex` has always reached the built-in `hex`. Without that,
`in` is unit conversion, which took the word as a unit and labelled the number
with it (`10.00 roman`); a word that is neither a unit nor a converter is now
refused there by name.

Two limits keep the rewrite from shadowing anything:

- **Only `in`, not `to`.** A word after `to` is a percentage change to a
  variable, `start to n`, and a converter is often named like one (the derived
  units register `N`, `V` and `W`, which `n`, `v` and `w` reach), so `to` keeps
  its reading.
- **Only an ordinary word.** A name the lexer reads as a unit keeps its unit
  meaning after `in`: the datetime package's `month` converter does not take
  `5 hours in month` away from unit conversion. Pick a name that is not a unit,
  as `roman` is not.

The rewrite asks the same registry `as` asks, so `in` reaches exactly the
converters `as` does.

## Names and their case

A name is matched without regard to case, so `255 as ROMAN` and `as Roman` reach
`roman`, with one exception: a name you register with capitals is also kept
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
error value. But you may see a value of a type you did not expect: `10 as roman`
is a number, `"x" as roman` is a string. Prefer returning the value unchanged over
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
