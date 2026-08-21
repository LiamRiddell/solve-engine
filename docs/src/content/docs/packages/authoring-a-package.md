---
title: Writing a package
description: The package contract, and a walkthrough of a working example.
---

Every feature in the engine is a package, including arithmetic. Writing one is
the supported way to add syntax.

## The quick path: one function

Most of the time you only want to add a function: a name, some arguments, a
result. You should not have to learn the parser and the bytecode VM to do that,
so `defineFunction` derives the whole wiring from a declaration and hands back a
package you register like any other.

```ts
import { defineFunction, ExpressionEngine } from "solve-engine";
import { BUILTIN_PACKAGES } from "solve-engine/packages";

const vat = defineFunction({
  name: "vat",
  args: [{ name: "amount", type: "number" }],
  returns: "number",
  call: (amount) => amount * 1.2,
});

const engine = new ExpressionEngine("en", false, undefined, undefined, [
  ...BUILTIN_PACKAGES,
  vat,
]);

engine.evaluateExpression("vat(100)"); // 120
```

That is the whole thing. From the declaration, `defineFunction` allocates the
plugin function index, registers the name as a keyword so it tokenises, builds
the `name(args)` parselet, and wraps `call` in a handler that checks the call
before running it. `call` receives plain JavaScript values and returns one; the
engine does the unwrapping and wrapping.

The checks come for free, and they raise the engine's own structured errors
rather than anything you hand-roll:

```ts
engine.evaluateExpression("vat()");      // vat() takes 1 argument, but was given none
engine.evaluateExpression('vat("x")');   // vat() expects "amount" to be a number, but was given a string
```

`call`'s parameters and return are typed from the declaration, so
`(amount) => amount * 1.2` needs no annotations: `amount` is a `number` because
the argument said so, and returning anything but a `number` is a compile error.

Each `defineFunction` returns a self-contained package named `solve-fn-<name>`.
Add several functions by passing several packages.

### What it covers, and what it does not

`defineFunction` is deliberately the common case, not a second contract. Its
arguments are a fixed-length list, and both arguments and the return are one of
`number`, `string`, or `boolean`. A `number` argument accepts a plain number or
a based literal such as `0xFF`; a value with a unit, a percentage, or a date is
a different kind of value and is refused rather than quietly reinterpreted.

Anything past that keeps using the full contract below, unchanged:

- variadic or optional arguments,
- other value types (units, percentages, dates, matrices),
- asynchronous work (a network lookup), which wants an
  [async resolver](/packages/extension-points/) and a parselet,
- any syntax that is not `name(args)`.

`defineFunction` sits on top of the contract and changes none of it, so you can
reach for the longhand the moment the shortcut stops fitting.

## The contract

A package is a plain object. Every field is optional, so you declare only what
you need.

```ts
import type { IEnginePackage } from "solve-engine";

export const myPackage: IEnginePackage = {
  name: "my-package",
  engineVersion: "^1.0.0",
};
```

`name` must be unique. `engineVersion` is a semantic version range checked at
registration, so a package built against an incompatible engine is refused with
a clear message rather than failing mysteriously later.

## What a package can contribute

| Field | Purpose |
| --- | --- |
| `lexerVocabulary` | Keywords, operators and units the tokeniser should recognise |
| `prefixParselets` | Parsing rules for tokens that begin an expression |
| `infixParselets` | Parsing rules for tokens that combine expressions |
| `pluginFunctions` | Functions the virtual machine can call |
| `normalizerRules` | Token-stream rewrites, including phrase fusion |
| `asConverters` | Targets for the `as` conversion form |
| `variableSources` | Providers of variable values |
| `asyncResolvers` | External data sources |
| `tokenCategories` | Highlighting categories for new tokens |
| `completionItems` | Editor completion candidates |

## Registering

```ts
import { ExpressionEngine } from "solve-engine";

const engine = new ExpressionEngine("en", false, undefined, undefined, [
  ...BUILTIN_PACKAGES,
  myPackage,
]);
```

Order matters. Arithmetic registers first so its operators are in place before
anything builds on them.

## Choosing your syntax carefully

The hardest part of writing a package is not the code, it is picking syntax that
does not collide with ordinary prose. Read
[trigger words](/syntax/trigger-words/) before claiming a bare English word.
The short version: prefer a multi-word phrase, and prefer requiring a
parenthesis, over claiming a common noun as a keyword.
