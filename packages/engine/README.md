<div align="center">

<img src="https://raw.githubusercontent.com/LiamRiddell/solve-engine/main/playground/public/solve-logo.svg" alt="Solve" width="96" />

# solve-engine

**A calculator that reads like a sentence.**

[![npm](https://img.shields.io/npm/v/solve-engine?color=%230b7285&label=npm)](https://www.npmjs.com/package/solve-engine)
[![CI](https://github.com/LiamRiddell/solve-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/LiamRiddell/solve-engine/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/solve-engine)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/LiamRiddell/solve-engine/blob/main/packages/engine/LICENSE)

[Documentation](https://liamriddell.github.io/solve-engine/) &nbsp;&#8226;&nbsp;
[Playground](https://liamriddell.github.io/solve-engine/playground/) &nbsp;&#8226;&nbsp;
[Syntax reference](https://liamriddell.github.io/solve-engine/syntax/cheatsheet/)

</div>

A lexer, Pratt parser, bytecode VM, and an extensible package system for
evaluating natural-language-flavoured expressions: `2 + 2 * 10`, `50% of 200`,
`3 days + 4 hours`, `10 USD to GBP`, `100 cm + 2 m`.

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
import { ExpressionEngine } from "solve-engine";

const engine = new ExpressionEngine("en");
const [value] = engine.evaluateExpression("2 + 2 * 10");

console.log(value.toNumber()); // 22
```

`evaluateExpression` throws an `EngineError` (see `solve-engine/errors`) on a parse or
evaluation failure, wrap calls with untrusted input in a `try`/`catch`.

For line-oriented input (e.g. a document made of multiple expressions, some referencing
variables defined on earlier lines), use `evaluateLine`/`parseDocument` instead, see the
`engine` subpath below.

## Formatting a result for display

```typescript
import { formatValue } from "solve-engine/format";

const [value] = engine.evaluateExpression("10 USD to GBP");
console.log(formatValue(value)); // uses DEFAULT_FORMATTING_SETTINGS if no settings passed
```

## Package structure

`solve-engine` exposes its API as a set of subpath exports, grouped by how stable/low-level
they are:

| Subpath | Purpose |
|---|---|
| `solve-engine` | Start here, `ExpressionEngine`, `PackageRegistry`/`packageRegistry`, `IEnginePackage`. |
| `solve-engine/engine` | `ExpressionEngine` and its supporting types (`LineEvaluation`, `EvalResults`, etc.) directly, without the package-registration wrapper. |
| `solve-engine/vm` | The bytecode VM: `Value`/`ValueType`, opcode dispatch, `allocatePluginFunctionIndex`. |
| `solve-engine/format` | Turning a `Value` into a display string (numbers, dates, units, vectors, ...). |
| `solve-engine/language` | Editor-agnostic language service: token categories, completions, highlighting. |
| `solve-engine/packages` | The built-in packages (arithmetic, datetime, time, dice, uom, currency, vector, conditionals, converters, mathphrases, ...). |
| `solve-engine/constants` | Engine configuration types and defaults (`EngineConfig`, `VMConfig`, ...). |

The following subpaths are **advanced-public**, everything a third-party package author
needs to extend the engine, but with a looser stability contract than the tier above (these
are the pieces the built-in packages and the [OSRS example](https://github.com/LiamRiddell/solve-engine/tree/main/packages/engine/examples/osrs) themselves
depend on):

| Subpath | Purpose |
|---|---|
| `solve-engine/lexer` | Tokenizer, `LexerVocabulary` for registering custom keywords/operators/units. |
| `solve-engine/parser` | Pratt parser, `BytecodeBuilder`, `OpCode`. |
| `solve-engine/normalizer` | Post-lexer token transforms (phrase fusion, implicit multiply). |
| `solve-engine/variables` | Variable resolution (`IVariableSource`). |
| `solve-engine/resolvers` | Async resolvers (`IAsyncResolver`) for data that loads asynchronously. |
| `solve-engine/errors` | `EngineError` and the error factory. |
| `solve-engine/utilities` | Small stateless helpers (e.g. `stripQuotes`). |
| `solve-engine/uom` | Units-of-measurement conversion tables and currency exchange. |
| `solve-engine/services` | Supporting services (query client construction, etc). |

Anything not listed above (`telemetry`, `cache`, `diagnostics`, `types`, `workers`) is
internal and not part of the package's public contract, it may change or disappear between
minor versions without notice.

## Authoring a package

A **package** (`IEnginePackage`) is a plain data descriptor bundling everything needed to
extend the engine with a new domain: custom tokens, parselets, VM opcode handlers, variable
sources, and optional async resolvers. See
[`solve-engine/api`'s `IEnginePackage`](https://github.com/LiamRiddell/solve-engine/blob/main/packages/engine/src/api/PackageRegistry.ts) for the full field list
with inline documentation and examples for each field.

Minimal shape:

```typescript
import { allocatePluginFunctionIndex } from "solve-engine/vm";
import type { IEnginePackage } from "solve-engine";

const MY_FN_IDX = allocatePluginFunctionIndex();

export const MY_PACKAGE: IEnginePackage = {
  name: "MyPackage",
  // engineVersion: "^0.1.0", // optional, see below
  prefixParselets: [{ tokenType: "MY_FUNC", parselet: new MyParselet() }],
  pluginFunctions: [{ index: MY_FN_IDX, handler: (args) => /* ... */ }],
};
```

Register it either as one of the packages passed to the `ExpressionEngine` constructor, or
at runtime via `ExpressionEngine.registerPackage()` / `unregisterPackage()`.

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

**Cross-instance isolation is partial.** Plugin functions, the opcode registry and
variable sources are now owned per `ExpressionEngine`, so two engines with different
package sets no longer interfere across those. The lexer and the currency exchange rates
are still module-level singletons, so full isolation between two engines in one process
cannot yet be assumed. Tracked as "L1, EngineContext"; three of its five migrations have
landed and the remaining two are a prerequisite for 1.0.0 proper.

**`variableSources` does nothing.** A package can declare them, the engine registers and
unregisters them, and no evaluation path ever consults them. Treat the extension point as
absent until that changes.

**Async results need a host hook.** `AsyncResolutionBatcher.onLineResult` is the only
mechanism that patches a resolved async value back into the document model, and it is not
wired inside the package. A host that does not supply it gets async values that never
resolve, with no error to explain why.

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
