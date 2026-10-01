---
title: Testing a package
description: A test kit that speaks in expressions, not in opcodes.
---

A package is worth testing by what it lets a person type, not by the bytecode it
emits. Asserting on emitted opcodes pins the implementation: a refactor that
keeps every answer correct still breaks the tests. The `solve-engine/testing`
entry point is the supported way to test a package by its expressions instead.

It is framework-agnostic. Nothing in it imports a test runner, an assertion that
fails throws and one that passes returns, so it drops into Jest, Vitest, a plain
script, or `node:assert` unchanged.

## Evaluating expressions

`createTestEngine` builds an engine with the built-in packages and the package
under test. `expectExpression` evaluates a string and returns matchers.

```ts
import { createTestEngine, expectExpression } from "solve-engine/testing";
import { myPackage } from "./my-package";

const engine = createTestEngine([myPackage]);

expectExpression(engine, "2 gp + 3 gp").toEqual(5, "gp");
expectExpression(engine, "gp").toFailWith("UNDEFINED_VARIABLE");
```

`toEqual` checks the value, and the unit too when you pass one. Omit the unit to
leave it unchecked. `toFailWith` checks the error code, whether the engine threw
it or a plugin returned it, so a package's own error codes are matched the same
way as the built-in ones.

| Matcher | Passes when |
| --- | --- |
| `toEqual(value, unit?)` | The result equals `value`, and carries `unit` when given |
| `toFailWith(code)` | The expression failed with exactly that error code |
| `toEvaluate()` | The expression produced a value, not an error |
| `toBeError()` | The expression failed, any code |
| `toBePending()` | The result is still resolving asynchronously |

Matchers chain, and `.value` exposes the raw result for an assertion the
matchers do not cover.

```ts
const result = expectExpression(engine, "10 gp * 3").toEvaluate().value;
```

`createTestEngine` loads the built-ins by default, because almost every package
builds on arithmetic. Pass `{ includeBuiltins: false }` to test a package on its
own. Unlike constructing an engine directly, it registers the package under test
honestly: a package whose `engineVersion` the engine cannot satisfy, or whose
keyword collides with a built-in, throws here rather than being logged and
skipped.

## Checking the package itself

Several mistakes are worth catching before the package ships, and
`expectPackage` catches them.

```ts
import { expectPackage } from "solve-engine/testing";
import { BUILTIN_PACKAGES } from "solve-engine/packages";

// A trigger word that shadows ordinary prose turns a sentence into arithmetic.
expectPackage(myPackage).notToShadow(["price", "in", "of"]);

// Colliding with another package's vocabulary silently breaks one of them.
expectPackage(myPackage).notToCollideWith(BUILTIN_PACKAGES);

// A declared engineVersion range that never resolves fails at registration.
expectPackage(myPackage).toDeclareCompatibleEngineVersion();

// Every part the package declares can be reached.
expectPackage(myPackage).toBeWellFormed();
```

`notToShadow` compares the words a package claims (keywords, units, operators,
and single-word phrases) against a list of prose words, defaulting to a built-in
set of common English words. A multi-word phrase is the safe pattern the
[trigger words](/syntax/trigger-words/) guide recommends, so it is never
flagged. `notToShadow` and `notToCollideWith` return what they found, so a test
can inspect rather than only assert.

`notToCollideWith` fails on error-severity collisions by default, the ones that
always break something. Raise the strictness to `"warning"` or `"info"` to fail
on the overlaps that silently pick a winner or only differ cosmetically.

`toBeWellFormed` checks the mistakes that are accepted when a package is
registered and then fail, or never run, at the first line that uses them. It
reports every problem at once:

- the package has a name, and it registers against the built-ins;
- no parselet claims a token the parser reads itself, such as `NUMBER`, `IDENT`
  or `+`, where it would never run;
- every token type of its own has a `tokenCategories` entry, so an editor can
  colour it;
- a keyword, operator, phrase or call is not keyed to one token while its
  parselet waits for another (`twice` making `DOUBLE_KW` beside a parselet
  for `DOUBLE`);
- every plugin function a parselet calls by name is in `pluginFunctions`.

The last is found by compiling the package's own words in the shapes a line
usually puts them in (`word 1`, `word(1)`, `1 op 1`), so a call reached only by
some other shape is not seen: an expression test is still the proof that a form
works. A token read inside another parselet's grammar, the `and` of `between X
and Y`, is not a mistake and is not reported.

## When an expectation is not met

A failed matcher throws an `ExpectationError` carrying a `code`, an `expected`
and an `actual`, and a message that names the expression and what it found. That
is an ordinary `Error`, so any runner reports it, and `instanceof
ExpectationError` tells a kit failure apart from an unrelated exception.
