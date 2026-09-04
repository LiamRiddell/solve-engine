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
import { createEngine, defineFunction } from "solve-engine";

const vat = defineFunction({
  name: "vat",
  args: [{ name: "amount", type: "number" }],
  returns: "number",
  call: (amount) => amount * 1.2,
});

// createEngine registers every built-in package; extraPackages adds yours on top.
const engine = createEngine({ extraPackages: [vat] });

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
  [async data source](/guide/async-data-sources/) and a parselet,
- any syntax that is not `name(args)`.

`defineFunction` sits on top of the contract and changes none of it, so you can
reach for the longhand the moment the shortcut stops fitting.

## The longer path: a whole package, scaffolded

A function is not always what you want. A phrase, an operator, a unit or a
normalizer rule needs a package of its own, and that touches at least eight
places before it can be judged: the package folder, both lists in
`BUILTIN_PACKAGES`, a spec, a documentation page, the sidebar, a changeset, and
the derived figures.

If you are working in a clone of this repository, one command writes all of it.

```bash
npm run new:package -- fuel-economy --group "Units"
```

What comes out registers, evaluates something, and passes `npm run verify`
before you edit a line: `fuel economy of 21` answers `42`. That placeholder is
there so the whole chain is wired and green from the first run, phrase to
parselet to plugin function to pure operation to spec to a proven documentation
example. Replace the behaviour, keep the shape.

The generated files carry the comments this codebase expects rather than
placeholders to delete, including the two every package here writes down: what
it answers, and what it deliberately refuses to guess at.

The command edits `builtins.ts` and the docs sidebar by matching on text in
them. If either has moved on, it says so and names the file rather than writing
something plausible into the wrong place, and the fix is to add that one entry
by hand.

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

| Field | Purpose | How-to |
| --- | --- | --- |
| `lexerVocabulary` | Keywords, operators and units the tokeniser should recognise | [Units and keywords](/packages/units-and-keywords/) |
| `prefixParselets` | Parsing rules for tokens that begin an expression | [Functions and operators](/packages/functions-and-operators/) |
| `infixParselets` | Parsing rules for tokens that combine expressions | [Functions and operators](/packages/functions-and-operators/) |
| `pluginFunctions` | Functions the virtual machine can call | [Functions and operators](/packages/functions-and-operators/) |
| `normalizerRules` / `phrases` / `callFusions` | Token-stream rewrites: phrase fusion, `name(` function-call words, and the `shape` a rule declares so it is only tried where it can fire | [Recognising phrases and words](/packages/recognising-phrases/) |
| `asConverters` | Targets for the `as` conversion form | [Custom as converters](/packages/as-converters/) |
| `asyncResolvers` | External data sources | [Async data source](/guide/async-data-sources/) |
| `tokenCategories` | Highlighting categories for new tokens | [Highlighting and completions](/packages/highlighting-and-completions/) |
| `completionItems` | Editor completion candidates | [Highlighting and completions](/packages/highlighting-and-completions/) |

Each field has a hands-on guide in the **How-to** column: this table is the map,
and each guide walks its extension point end to end.

## Registering

The common case is your package on top of the built-ins, which `extraPackages`
does in one line:

```ts
import { createEngine } from "solve-engine";

const engine = createEngine({ extraPackages: [myPackage] });
```

Order matters, and `extraPackages` gets it right by construction: it appends your
package after the built-ins, so arithmetic and the rest are already in place
before anything you add builds on them. When you need to control the order
yourself, or leave the built-ins out entirely, pass an explicit `packages` list
to the `ExpressionEngine` constructor instead:

```ts
import { ExpressionEngine } from "solve-engine";
import { BUILTIN_PACKAGES } from "solve-engine/packages";

const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, myPackage] });
```

## Choosing your syntax carefully

The hardest part of writing a package is not the code, it is picking syntax that
does not collide with ordinary prose. Read
[trigger words](/syntax/trigger-words/) before claiming a bare English word.
The short version: prefer a multi-word phrase, and prefer requiring a
parenthesis, over claiming a common noun as a keyword.
