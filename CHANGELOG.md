# Changelog

## 1.0.0-beta.0

First published version. The engine itself is not new: it has been running
inside the Solve plugin for Obsidian and was extracted into its own repository
and package. What is new is that it is installable, documented, and checked.

### Requirements

Node 20 or later. Node 18 reached end of life, and shipping a new package
against it was not worth doing.

### Fixed before the first release

**The published bundle threw on import in Node.** The root entry inlined a web
worker module whose top-level `self.onmessage` ran at import time, so
`import { ExpressionEngine } from "solve-engine"` failed with `self is not
defined` before a single expression could be evaluated. Every test passed while
this was true, because the suite runs against source through path aliases and
nothing imported the build. A smoke test now imports the built package the way a
consumer does, as part of the standard verification gate.

**Type declarations resolved to the wrong module system.** Each of the 16
subpaths declared a single flat `types` pointing at the ESM declarations, so a
`require()` consumer resolved ESM-flavoured types from an ESM package and every
`.d.cts` on disk was unreachable. Subpaths now use nested conditions.
`arethetypeswrong` and `publint` run in continuous integration.

**A prerelease engine would have rejected the packages it was for.** Semver
sorts `1.0.0-beta.0` below `1.0.0`, so a package declaring `^1.0.0` fell outside
the range. Compatibility is now checked against the coerced version, which is
also the honest reading: a beta of 1.0.0 presents the 1.0.0 API surface.

### Changed

**A line awaiting external data no longer goes clean.** The tier evaluators
treated "no exception thrown" as success, but a pending value does not throw. A
line waiting on a resolver was marked clean, and nothing re-runs the preflight
for a clean line, so the value stayed pending forever with no error to explain
why.

**Engines own their registries.** Plugin functions, the opcode registry and
variable sources moved from module-level singletons onto a per-engine
`EngineContext`. Two engines in one process no longer interfere: registering a
package on one does not change what another computes. The `shared*` exports
remain as deprecated aliases.

**`PackageRegistry` is deprecated.** It writes into process-wide singletons that
engines no longer read, so a package registered through it is invisible to every
engine. Use `engine.registerPackage(pkg)`.

### Known limitations

Named openly rather than left to be discovered.

- The lexer and currency exchange remain shared instances, deliberately. Line
  classification does not depend on registered vocabulary, and exchange rates
  are global market data where sharing a cache is the correct behaviour. Both
  decisions are recorded in the code with the reasoning.
- `variableSources` is registered and tracked but never consulted during
  evaluation. It does nothing today.
- `AsyncResolutionBatcher.onLineResult` must be supplied by any host that
  displays async results. The engine cannot default it, because the host owns
  the document and the batcher has no reference to one. Leaving it unset now
  logs a warning the first time a value resolves with nowhere to go, rather
  than failing silently.
- The VM benchmark cases are all below the comparison harness's noise floor, so
  that suite contributes no regression signal yet.
- The API surface may still move before 1.0 proper.
