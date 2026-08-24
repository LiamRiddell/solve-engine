---
"solve-engine": major
---

Packages are explicit now, so the engine tree-shakes.

The `ExpressionEngine` constructor registered all built-in packages by default, which meant importing the engine pulled every package into a consumer's bundle whether they used it or not: finance, colour, weather and the rest were unconditionally in the parse path. The constructor now registers only the packages it is given, so a consumer's bundler drops every built-in they never import.

Parsed JavaScript, a consumer importing the engine and constructing it:

| | parsed |
| --- | --- |
| before | 475 KB (all 26 packages, always) |
| now, arithmetic only | 352 KB |

**This is a breaking change.** `new ExpressionEngine()` with no `packages` argument now registers nothing, so `2 + 2` on a bare engine is an undefined-token parse error rather than `4`. Two ways to adopt it:

For the common "I want everything" case, `createEngine()` is batteries-included: it registers the full built-in set in one call.

```typescript
import { createEngine } from "solve-engine";
const engine = createEngine();
```

For a slimmer engine, pass the packages you want. Importing them from `solve-engine/packages` tree-shakes the rest away.

```typescript
import { ExpressionEngine } from "solve-engine";
import { ARITHMETIC_PACKAGE, UOM_PACKAGE } from "solve-engine/packages";
const engine = new ExpressionEngine("en", false, undefined, undefined, [ARITHMETIC_PACKAGE, UOM_PACKAGE]);
```

The `fromJSON` restore path takes the same `packages` argument, and must be given the same set the snapshot was taken with, since a snapshot's compiled bytecode only lines up against the packages present when it was written.

The boundary: the built-in workers' offloaded compilation runs with a reduced vocabulary in a host that inlines them, since a package cannot cross the worker boundary. It falls back to main-thread compilation, so results are unaffected; giving those workers the full vocabulary without pulling the packages back into the main bundle is a separate change.

## Verification

- The engine's whole test suite runs against explicit packages: the tree-shaking contract (a bare engine registers nothing) is pinned, and `createEngine` is covered by its own spec. Every construction site across the suite, the tools, the workers, and the bundled-consumer contract was migrated.
- Tree-shaking is measured directly: a consumer importing `ExpressionEngine` plus one package bundles 123 KB smaller than one importing `BUILTIN_PACKAGES`.
- 7,815 tests across 345 suites, no failures. `npm run verify` green, including the bundled-consumer `sideEffects` smoke test.
