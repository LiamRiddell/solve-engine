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
| `await toResolveTo(value, unit?)` | Once the live value has settled, the result equals `value` (see [live values](#live-values)) |
| `await settled()` | Waits for a live value to settle, so the next matcher reads the settled result |

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

## Live values

A package that fetches live data (a price, a reading from a service) answers
**Pending** the first time a line runs: the engine starts the fetch and says
"not yet" rather than showing a stale or zero figure. `toBePending` confirms that
path was taken. `toResolveTo` is the other half: it waits for the fetch to land,
evaluates the line again, and compares what it resolved to.

The package below is built the way the [package
starter](https://github.com/LiamRiddell/solve-engine/tree/main/examples/package-starter)
builds its `rainfall("Oslo")`: with `createQueryResolver` from
`solve-engine/resolvers`, the engine's helper for a lookup of one quoted query
(see [the short way](/guide/async-data-sources/#the-short-way-createqueryresolver)).
The helper builds the resolver, which starts the fetch before the line runs, and
the plugin function that reads its answer, so the package supplies only the
fetch. Taking the fetch as an argument is what makes the package testable: the
test hands it a stub, and nothing reaches a network.

```ts
import type { IEnginePackage } from "solve-engine";
import type { PrefixParselet, Parser, BytecodeBuilder } from "solve-engine/parser";
import { BindingPower } from "solve-engine/parser";
import type { Token } from "solve-engine/lexer";
import { createQueryResolver } from "solve-engine/resolvers";
import { pluginFunctionIndexFor, uomValue } from "solve-engine/vm";
import { createTestEngine, expectExpression } from "solve-engine/testing";

// tide("Dover") asks a service for the height of the tide, in metres.
class TideParselet implements PrefixParselet {
  readonly category = "Tides";
  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.consume("LPAREN");
    parser.parseExpression(BindingPower.Lowest, builder);
    parser.consume("RPAREN");
    builder.emitPluginCall("tide", 1);
  }
}

function createTidesPackage(fetchHeight: (port: string, signal: AbortSignal) => Promise<number>): IEnginePackage {
  // The resolver watches for the plugin call by the index the engine files
  // `tide` under: the package name and the function name.
  const { resolver, pluginFunction } = createQueryResolver({
    namespace: "tides",
    pluginFunctionIndex: pluginFunctionIndexFor("tides:tide"),
    fetchQuery: async (port, signal) => uomValue(await fetchHeight(port, signal), "m"),
  });
  return {
    name: "tides",
    engineVersion: "^2.0.0",
    callFusions: { tide: "TIDE_CALL" },
    prefixParselets: { TIDE_CALL: new TideParselet() },
    pluginFunctions: { tide: pluginFunction },
    asyncResolvers: [resolver],
    tokenCategories: { TIDE_CALL: "function" },
  };
}

// The test hands the package a stub in place of the service.
const engine = createTestEngine([createTidesPackage(async () => 4.2)]);

expectExpression(engine, 'tide("Dover")').toBePending();
await expectExpression(engine, 'tide("Dover")').toResolveTo(4.2, "m");

// A service that fails is a settled result too, with the code the resolver gives it.
const offline = createTestEngine([createTidesPackage(async () => { throw new Error("no signal"); })]);

expectExpression(offline, 'tide("Dover")').toBePending();
(await expectExpression(offline, 'tide("Dover")').settled()).toFailWith("TIDES_QUERY_FAILED");
```

`toResolveTo` waits within one deadline, 5,000 ms unless you pass
`{ timeoutMs }` as its third argument, and loops while it waits: a line whose
first fetch reveals a second is evaluated again after each one lands. A value
still Pending at the deadline fails with `EXPECTED_SETTLED`, so a resolver that
never answers is a failed test rather than a hung one. A fetch that fails is a
settled result too: `await expectExpression(engine, line).settled()` waits, and
`toFailWith` then reads the failure's code, `TIDES_QUERY_FAILED` above, which is
the code `createQueryResolver` gives a failure unless its `onError` option builds
one of the package's own.

The boundary: the resolver reads the port from the line before it runs, so the
query has to be written there in quotes. A port held in a variable is known only
as the line runs, and the plugin function answers `TIDES_NOT_PREFLIGHTED`; the
starter shows how to turn that into a refusal of the package's own. A lookup
whose input is computed needs the resolver that [fetches on a cache
miss](/guide/async-data-sources/#resolvers-that-never-reach-a-network) instead.

The wait is the engine's own `settle()`, which a host can call as well (see
[async and live data](/guide/async-and-live-data/#waiting-for-every-value-to-settle)).
It waits for fetches already started; it never starts one, so there is nothing
to wait for until the line has been evaluated once.

## Whole documents

Some forms only mean something in a document: a line reference (`line 2 * 3`), a
category tag total (`total of #food`), a table column, goal seek. A single
expression has no document to read, so `expectExpression` cannot test them.
`expectDocument` evaluates a whole document, the way a live editor does, waits
for any live values in it to settle, and returns each line with the same
matchers.

```ts
import { createTestEngine, expectDocument } from "solve-engine/testing";

const engine = createTestEngine();
const doc = await expectDocument(engine, ":price = 4\n:qty = 3\nprice * qty\nline 3 + 1");

doc.line(3).toEqual(12);
doc.line(4).toEqual(13);
```

`doc.line(n)` counts from 1, and a number the document does not have fails with
`EXPECTED_LINE`. A line with nothing to evaluate (a heading, prose, a blank)
fails every matcher but `toBeError`, and `doc.lines` holds the raw results for
anything the matchers do not cover. A line still Pending at the deadline is left
Pending, so `toBePending` can confirm it.

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
