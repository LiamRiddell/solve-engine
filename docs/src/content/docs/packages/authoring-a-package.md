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
plugin function index, declares the name as a [call word](/packages/recognising-phrases/#function-call-words-callfusions),
builds the `name(args)` parselet, highlights the call as a function, offers it
in completion with its signature (`vat(amount: number): number`), and wraps
`call` in a handler that checks the call before running it. `call` receives
plain JavaScript values and returns one; the engine does the unwrapping and
wrapping.

A call word becomes the call only where an opening parenthesis follows it, so
the name stays an ordinary word everywhere else. With `vat` defined, a reader
can still write `:vat = 0.2`, `vat * 100` or a `vat:` label, and `vat(100)`
on the next line is still the call. The match ignores case, so `VAT(100)` is
the same call.

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

The name has to be one the engine reads as a plain word. A name it already
reads as something else, a unit (`kg`), a keyword (`in`) or a built-in function
(`sqrt`), could never become the call, so registering it is refused with
`PLUGIN_CALL_FUSION_UNREACHABLE`. `createEngine` logs the refusal and carries on
without that function. A name another package already uses as a call word, such
as `md5`, is allowed: the engine warns, the later registration is in force, and
unregistering it hands the word back.

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

`name` must be unique and not empty: the engine keeps everything a package adds
under its name, so a package without one is refused at registration. `engineVersion`
is a semantic version range checked at registration, so a package built against
an incompatible engine is refused with a clear message rather than failing
mysteriously later.

## What a package can contribute

| Field | Purpose | How-to |
| --- | --- | --- |
| `lexerVocabulary` | Keywords, operators and units the tokeniser should recognise | [Units and keywords](/packages/units-and-keywords/) |
| `prefixParselets` | Parsing rules for tokens that begin an expression, written by hand or built from a phrase's words with `definePhrasePattern` | [Functions and operators](/packages/functions-and-operators/), [Recognising phrases and words](/packages/recognising-phrases/#words-around-their-operands-definephrasepattern) |
| `infixParselets` | Parsing rules for tokens that combine expressions | [Functions and operators](/packages/functions-and-operators/) |
| `pluginFunctions` | Functions the virtual machine can call | [Functions and operators](/packages/functions-and-operators/) |
| `normalizerRules` / `phrases` / `callFusions` | Token-stream rewrites: phrase fusion, `name(` function-call words, and the `shape` a rule declares so it is only tried where it can fire | [Recognising phrases and words](/packages/recognising-phrases/) |
| `asConverters` | Targets for the `as` conversion form | [Custom as converters](/packages/as-converters/) |
| `asyncResolvers` | External data sources: the fetch (`createQueryResolver` for a question and a fetch), how many run at once, and the record of where each fetched value came from | [Async data source](/guide/async-data-sources/) |
| `tokenCategories` | Highlighting categories for new tokens | [Highlighting and completions](/packages/highlighting-and-completions/) |
| `completionItems` | Editor completion candidates | [Highlighting and completions](/packages/highlighting-and-completions/) |
| `explain` | Describe the package's own calls, conversions and phrases as readable steps when a host explains a line | [Explaining your steps](/packages/explaining-steps/) |

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

### When a package fails to register

A package can fail to register: its `engineVersion` range is not satisfied
(`PACKAGE_ENGINE_VERSION_MISMATCH`), a keyword it declares is one a built-in
already owns (`PLUGIN_KEYWORD_COLLISION`), it has no name
(`PACKAGE_NAME_MISSING`), or a resolver it carries waits for a plugin function
the package does not declare (`PACKAGE_RESOLVER_FUNCTION_MISSING`). Through
`registerPackage` the failure is thrown, with that code. Through the constructor and
`createEngine` the engine is built without the package and the failure is
logged, so one bad package cannot take the whole engine down, which is also how
a reader in a host with no console meets it: as a parse error on every line that
uses the package. Two options say so instead:

```ts
// Throw the package's coded error from the constructor.
const strict = createEngine({ extraPackages: [myPackage], strict: true });

// Or be told of each failure, and build with the rest.
const told = createEngine({
  extraPackages: [myPackage],
  onPackageError: (pkg, error) => report(`${pkg.name}: ${error.code}`),
});

told.getRegisteredPackages(); // the names that registered, in order
```

A strict engine, and one whose `onPackageError` throws, unregisters the packages
it had already registered before it throws, so nothing is left behind in the
registries engines share. Collisions that only pick a winner between two
packages stay warnings, since a package may replace a built-in's grammar on
purpose. `expectPackage(myPackage).toBeWellFormed()` (see
[testing a package](/packages/testing-a-package/#checking-the-package-itself))
catches most of these before a package ships.

## Choosing your syntax carefully

The hardest part of writing a package is not the code, it is picking syntax that
does not collide with ordinary prose. Read
[trigger words](/syntax/trigger-words/) before claiming a bare English word.
The short version: prefer a multi-word phrase, and prefer requiring a
parenthesis, over claiming a common noun as a keyword.
