---
title: Writing a package
description: The package contract, and a walkthrough of a working example.
---

Every feature in the engine is a package, including arithmetic. Writing one is
the supported way to add syntax.

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
