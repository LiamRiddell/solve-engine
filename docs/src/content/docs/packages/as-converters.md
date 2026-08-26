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
asConverters?: Record<string, (value: Value) => Value>;
```

Each handler takes the value on the left of `as` and returns the converted one.
That is the whole contract. Here is a package that adds a `roman` target:

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
