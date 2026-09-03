<div align="center">

<img src="https://raw.githubusercontent.com/LiamRiddell/solve-engine/main/static/solve-engine-banner-github.png" alt="Solve, a natural language expression engine" width="100%" />

**A calculator that reads like a sentence.**

Type what you mean. Units, currencies, percentages, dates, matrices and
plain-English phrasing all work in the same expression, and the answer
appears as you type.

[![npm](https://img.shields.io/npm/v/solve-engine?color=%230b7285&label=npm)](https://www.npmjs.com/package/solve-engine)
[![CI](https://github.com/LiamRiddell/solve-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/LiamRiddell/solve-engine/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/solve-engine)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/LiamRiddell/solve-engine/blob/main/packages/engine/LICENSE)

[Documentation](https://liamriddell.github.io/solve-engine/) &nbsp;&#8226;&nbsp;
[Playground](https://liamriddell.github.io/solve-engine/playground/) &nbsp;&#8226;&nbsp;
[Syntax reference](https://liamriddell.github.io/solve-engine/syntax/cheatsheet/)

</div>

That's what a user sees. This package is the engine behind it: a lexer, a
Pratt parser, a bytecode VM, and an extensible package system, with units,
currencies, percentages, dates and matrices already built in. There's no
expression parser to write and no plumbing to wire up. It evaluates
natural-language-flavoured expressions out of the box: `2 + 2 * 10`,
`50% of 200`, `3 days + 4 hours`, `10 USD to GBP`, `100 cm + 2 m`.

Originally the engine inside
[Solve for Obsidian](https://github.com/LiamRiddell/obsidian-solve), extracted
so it can be embedded in any host: an editor plugin, a CLI, a desktop app, a
server. No dependency on a UI framework, a DOM, or an editor.

See [ARCHITECTURE.md](https://github.com/LiamRiddell/solve-engine/blob/main/packages/engine/ARCHITECTURE.md) for how the pipeline, package system, async
evaluation model, and caching layers fit together, plus a candid list of known
architectural debt.

## Installation

```bash
npm install solve-engine
```

## Quick start

```typescript
import { createEngine } from "solve-engine";

const engine = createEngine();
const value = engine.evaluateExpression("2 + 2 * 10");

console.log(value.toNumber()); // 22
```

Two kinds of failure, deliberately different. A line the parser cannot read
(`10 +`), or one that names a variable no line defined, throws an `EngineError`
(see `solve-engine/errors`), so wrap calls on untrusted input in a `try`/`catch`.
A line the engine can run but cannot answer (an impossible conversion, a rate it
has no data for, a live value still loading) comes back as a `Value` whose
`isError()` or `isPending()` says so, never as a throw, which is the right shape
for input being typed one character at a time. Check `isFault()` before
`toNumber()`: a faulted value reads as `0` through it.

For line-oriented input (e.g. a document made of multiple expressions, some referencing
variables defined on earlier lines), use `evaluateLine`/`parseDocument` instead, see the
`engine` subpath below.

## Engine lifecycle

Call `clear()` when you are finished with an engine that has parsed a document.
Dropping your last reference is not enough on its own: the async batcher is
reachable from the module-level data query service, so a parsed engine stays
retained until `clear()` releases it.

```typescript
const engine = createEngine();
engine.parseDocument(text);
// ... read results ...
engine.clear();
```

Measured per engine after a forced collection:

| Lifecycle | Retained |
| --- | --- |
| constructed, never parsed | 8.2KB |
| constructed and parsed | 128KB |
| constructed, parsed, cleared | 10KB |

This matters most for hosts that create one engine per document or per tab. Over
10,000 create-and-drop cycles the uncleared path reaches roughly 1.2GB.

Reusing one engine across documents is also fine. `clear()` resets an engine for
the next document rather than consuming it, so there is no separate teardown
call to remember.

## Formatting a result for display

```typescript
import { formatValue } from "solve-engine/format";

const value = engine.evaluateExpression("10 USD to GBP");
console.log(formatValue(value)); // uses DEFAULT_FORMATTING_SETTINGS if no settings passed
```

## Package structure

`solve-engine` exposes its API as a set of subpath exports, grouped by how stable/low-level
they are:

| Subpath | Purpose |
|---|---|
| `solve-engine` | Start here: `createEngine`, `ExpressionEngine`, `defineFunction`, `IEnginePackage`, and the result surface `Value`, `ValueType`, `formatValue`. |
| `solve-engine/engine` | `ExpressionEngine` and its supporting types (`Explanation`, `EngineSnapshot`, etc.) directly, without the package-registration wrapper. |
| `solve-engine/vm` | The bytecode VM: `Value`/`ValueType`, the value constructors, opcode dispatch. |
| `solve-engine/format` | Turning a `Value` into a display string (numbers, dates, units, vectors, ...) and the formatting settings. |
| `solve-engine/language` | Editor-agnostic language service: token categories, completions, highlighting. |
| `solve-engine/packages` | The built-in packages (arithmetic, datetime, time, dice, uom, currency, vector, conditionals, converters, mathphrases, ...). |
| `solve-engine/constants` | Engine configuration types and defaults (`EngineConfig`, `VMConfig`, `NetworkConfig`, ...). |
| `solve-engine/worker` | Off-main-thread evaluation: `createWorkerEngine`, `startWorkerRuntime`, the transports and the result DTOs. |
| `solve-engine/testing` | A test kit for package authors: `createTestEngine`, `expectExpression`, `expectPackage`. |

The following subpaths are **advanced-public**, everything a third-party package author
needs to extend the engine, but with a looser stability contract than the tier above (these
are the pieces the built-in packages and the [OSRS example](https://github.com/LiamRiddell/solve-engine/tree/main/packages/engine/examples/osrs) themselves
depend on):

| Subpath | Purpose |
|---|---|
| `solve-engine/lexer` | Tokenizer, `LexerVocabulary` for registering custom keywords/operators/units. |
| `solve-engine/parser` | Pratt parser, `BytecodeBuilder`, `OpCode`. |
| `solve-engine/normalizer` | Post-lexer token transforms (phrase fusion, implicit multiply). |
| `solve-engine/resolvers` | Async resolvers (`IAsyncResolver`) for data that loads asynchronously. |
| `solve-engine/errors` | `EngineError` and the error factory. |
| `solve-engine/utilities` | Small stateless helpers (e.g. `stripQuotes`). |
| `solve-engine/uom` | Units-of-measurement conversion tables and currency exchange. |
| `solve-engine/services` | Supporting services (query client construction, etc). |

Anything not listed above (`telemetry`, `cache`, `diagnostics`, `types`, `workers`) is
internal and not part of the package's public contract, it may change or disappear between
minor versions without notice.

## Adding a function

The shortest way to teach the engine a new name is `defineFunction`: declare the
name, the argument types and the return type, and get back a package that plugs
in beside the built-ins. No parser, no bytecode.

```typescript
import { createEngine, defineFunction } from "solve-engine";

const vat = defineFunction({
  name: "vat",
  args: [{ name: "amount", type: "number" }],
  returns: "number",
  call: (amount) => amount * 1.2,
});

const engine = createEngine({ extraPackages: [vat] });
engine.evaluateExpression("vat(100)").toNumber(); // 120
```

Arguments are a fixed list of `number`, `string` or `boolean`, and `call` is
synchronous; a mismatched call produces a structured error naming the argument.
Anything beyond that shape (a unit-bearing argument, a phrase rather than a
call, live data) is a package proper.

## Authoring a package

A **package** (`IEnginePackage`) is a plain data descriptor bundling everything
needed to extend the engine with a new domain: token vocabulary, normaliser
rules, parselets, plugin functions, `as` converters, completions, and optional
async resolvers. The [package author guides](https://liamriddell.github.io/solve-engine/packages/authoring-a-package/)
walk through each extension point; [`IEnginePackage`](https://github.com/LiamRiddell/solve-engine/blob/main/packages/engine/src/api/PackageRegistry.ts)
carries the full field list with inline documentation.

Minimal shape, a keyword that calls a function:

```typescript
import type { IEnginePackage } from "solve-engine";
import type { PrefixParselet } from "solve-engine/parser";
import { stringValue } from "solve-engine/vm";

const reverseParselet: PrefixParselet = {
  category: "Text",
  parse(parser, _token, builder) {
    parser.consume("LPAREN");
    parser.parseExpression(0, builder);
    parser.consume("RPAREN");
    // By name; the engine assigns the index when the package registers.
    builder.emitPluginCall("reverse", 1);
  },
};

export const MY_PACKAGE: IEnginePackage = {
  name: "my-package",
  // engineVersion: "^2.0.0", // optional, see below
  lexerVocabulary: { keywords: { reverse: "REVERSE_FN" } },
  prefixParselets: { REVERSE_FN: reverseParselet },
  pluginFunctions: { reverse: ([text]) => stringValue([...String(text.value)].reverse().join("")) },
};
```

Register it as one of the packages passed to the `ExpressionEngine` constructor
(or `createEngine`'s `extraPackages`), or at runtime via
`ExpressionEngine.registerPackage()` / `unregisterPackage()`.

### Declaring engine-version compatibility

`IEnginePackage.engineVersion` is an optional semver range (e.g. `"^0.1.0"`) declaring which
`solve-engine` versions your package is built against. It's checked against the real, running
engine version at registration time. Omit it and your package always registers, exactly as
before this field existed, this is the default for every package that predates it. Declare it
once you want protection against the reverse case: your package being loaded into a much
newer (or much older) engine whose `IEnginePackage` contract has since changed shape.

Unlike every other compatibility signal in this codebase (see `ARCHITECTURE.md` §5.2's
sibling-package collision warnings, which always log and proceed), a declared range the
running engine does **not** satisfy causes `registerPackage()` to **throw**, not warn, see
`ARCHITECTURE.md` §5.3 for the full reasoning.

### Three more extension points, beyond `pluginFunctions`

- **`solve-engine/parser`'s `definePhrasePattern()`**, build a phrase-grammar parselet
  (`roll between X and Y`, `average of X, Y, Z`) from a declarative list of
  `{ slots, emit }` alternatives instead of hand-writing `parser.consume()`/
  `parseExpression()` calls. See `packages/mathphrases/` for several real examples, and
  its own JSDoc for the one hard constraint (every alternative must start with a keyword
  slot) and when a hand-written parselet is the right call instead.
- **`solve-engine/resolvers`'s `createQueryResolver()`**, a factory for the common
  "one cached async fetch → one `Value`" shape (weather, stock prices, a game-item price
  API, see `examples/osrs`), generalizing the caching/staleness plumbing so a package
  only needs to write the fetch call and the response mapping.
- **`IEnginePackage.asConverters`**, contribute a custom `as <name>` conversion (e.g.
  `50% as decimal`) to the built-in `converters` package's grammar: `{ myUnit: (value) =>
  /* ... */ }`. No lexer keyword registration needed, any bare word after "as" that isn't
  one of the built-in names resolves against this registry at runtime.

See `ARCHITECTURE.md`'s §5.1 for the full reasoning behind each, including a real
regression (and its fix pattern) worth reading before picking a keyword for your own
package: a colon-prefixed variable name (`:name = expr`) can never be a keyword-shaped
word in this engine, so a common-noun trigger word (like "total") should be phrase-fused
with its qualifying keyword rather than claimed bare.

Two runnable examples, both under [`examples/`](https://github.com/LiamRiddell/solve-engine/tree/main/packages/engine/examples) (example code, not part of the
published package, see `files` in `package.json`, only `dist/` ships):

- [`examples/basic`](https://github.com/LiamRiddell/solve-engine/tree/main/packages/engine/examples/basic), the smallest complete package: one custom keyword
  (`reverse("text")`) dispatched through a plugin function, nothing else. Start here. Its
  test, [`__tests__/examples/basic/BasicPackage.spec.ts`](https://github.com/LiamRiddell/solve-engine/blob/main/packages/engine/__tests__/examples/basic/BasicPackage.spec.ts),
  shows the full register-and-evaluate loop end to end.
- [`examples/osrs`](https://github.com/LiamRiddell/solve-engine/tree/main/packages/engine/examples/osrs), a fuller example covering everything `basic` leaves
  out: a phrase-fused multi-word item name, an async resolver backed by a real HTTP API, a
  custom highlight category, and completion items. Prices Old School RuneScape Grand Exchange
  items (e.g. `ge("Abyssal whip")`).

## Known limitations

**Exchange rates are shared across engines, by design.** Plugin functions, the
opcode registry and the lexer are owned per `ExpressionEngine`, so two engines
with different package sets do not interfere. The currency rate cache is the one
deliberate exception: rates are market data with a fifteen-minute freshness
window, and two engines in one process fetching the same pair separately could
disagree about it. A host that primes rates (`currencyExchangeService.primeRates`)
primes them for every engine in the process.

**A live value reaches the document only through the event stream.** When a
fetch lands, the engine does not push the new value at you; it emits a
`lines-updated` event on `engine.getEventStream()` naming the lines to
re-evaluate. A host that reads neither that stream nor sets
`AsyncResolutionBatcher.onLineResult` sees the line stay pending, and a warning
says so once. The [async guide](https://liamriddell.github.io/solve-engine/guide/async-and-live-data/)
shows the loop.

## Development

Developed in the [solve-engine](https://github.com/LiamRiddell/solve-engine) repository as
an npm workspace (`packages/engine`).

```bash
npm run build   # tsup, emits ESM + CJS + .d.ts to dist/
npm run dev     # tsup --watch
npm test        # standalone jest run, scoped to this package
```

## License

MIT, see [LICENSE](https://github.com/LiamRiddell/solve-engine/blob/main/packages/engine/LICENSE).
