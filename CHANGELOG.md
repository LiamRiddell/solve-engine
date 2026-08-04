# Changelog

## 1.0.0-beta.0

First published version. The engine itself is not new: it has been running
inside the Solve plugin for Obsidian and was extracted into its own repository
and package. What is new is that it is installable, documented, and checked, and
that it grew a real computer-algebra system on the way.

### Requirements

Node 22 or later.

This is a correction rather than a change of direction. The repository already
could not install on Node 20: `size-limit` depends on `nanoid` 6, which requires
`^22 || ^24 || >=26`, and `.npmrc` sets `engine-strict`, so `npm ci` refused
outright. The Node 20 entry in the matrix had been failing at the install step,
which meant nothing was verifying the support the package claimed. Declaring a
floor nothing tests is worse than declaring a higher one honestly.

The engine's own code is unaffected. Nothing in it uses an API newer than Node
20, so a consumer already on Node 20 will most likely keep working; it is simply
no longer a version this project tests or supports.

### Symbolic algebra, and a computer-algebra system

`expand`, `factor`, `solve`, `cancel`, `apart`, `der`/`derivative`, `integral`,
`taylor` and `jacobian`, over exact rational and complex arithmetic rather than
floating point. An equation can also be written on its own line: put `x^2-4 = 0`
on one line and ask for `x =>` on a later one.

Factoring and solving work over the rationals, so `x^2-2` and `x^2+1` come back
unchanged rather than approximated, and an irrational root is given as a reduced
surd rather than a decimal. Cubics and quartics are solved in closed form where
one exists, complex roots included, and partial fractions make every rational
function integrable.

Two limits are reported rather than guessed at. A cubic with three distinct real
roots and no rational one is returned numerically, because those roots provably
cannot be written in real radicals. `integral` says what it cannot integrate
instead of approximating, which matters more than it sounds: a wrong integral is
indistinguishable from a right one wherever it gets used.

### Complex numbers

Exact arithmetic over the Gaussian rationals, with `i` as a literal and `conj`,
`re` and `im` as functions. `solve(x^2+1=0, x)` gives `[-i, i]`, and `sqrt(-4)`
is exactly `2i`.

### Programmer math

Hex, binary and octal literals, base conversion in both directions, shifts and
bitwise operators, gathered on their own documentation page along with the
data-size units.

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

**Three silent wrong answers in symbolic mode.** `SymbolicNode` had no
representation for exponentiation or function application, and `toNumber()`
reports `0` for a symbolic operand, so `x^2 + 3x + 2 =>` returned `3x+2`, `-x =>`
returned `-0`, and `sqrt(x) =>` returned `0`, none of them with any error. Exact
coefficients additionally fix a symbolic matrix inverse treating a
structurally-zero pivot as non-zero when it arrived as `5.551e-17`.

**`~` and `>>>` were unreachable.** Both were declared and neither could be
typed: `~` had an opcode, a lexer token and a VM implementation but no prefix
parselet, and `>>>` had only the opcode. Opcodes 159 and 160
(`THEREFORE_SOLVE`, `STORE_EQUATION_OR_ASSIGNMENT`) were declared and never
emitted or handled at all, and are removed.

**`hex(255) + 1` evaluated to `1`.** `hex()` and `bin()` returned a String, which
reads as zero in arithmetic. They return a number that displays in the requested
base, which is what `as hex` always returned, so all five spellings now agree and
the result still does arithmetic. Two display bugs on that path went with it:
`-255 as hex` rendered `0x-FF`, and `255.7 as hex` grew fractional hex digits.

### Changed

**Token CSS class names lost their `cm-` prefix, and the prefix is now
configurable.** `categoryClassName()` lived in the CodeMirror adapter and
returned `cm-solve-<category>`. Nothing about it was CodeMirror-specific, but
every host inherited CodeMirror's naming convention whether or not it used
CodeMirror. It is replaced by `tokenClassName()`, exported from
`solve-engine/language`, which returns `solve-<category>` and takes an optional
prefix; `createTokenClassName(prefix)` binds one once. To migrate, swap the
import and rename the matching CSS rules from `.cm-solve-*` to `.solve-*`, or
keep the old names with `createTokenClassName("cm-solve-")` and change nothing
else.

**The engine lifecycle contract is documented.** Call `clear()` when you are
finished with an engine that has parsed a document. Dropping the last reference
is not enough on its own, because the async batcher is reachable from the
module-level data query service, so a parsed engine stays retained until
`clear()` releases it. Measured per engine after a forced collection: 8.2KB
constructed, 128KB after `parseDocument`, 10KB after `clear()`. A host creating
one engine per document reaches roughly 1.2GB over 10,000 cycles without it. No
behaviour changed; what was missing was anything telling you to call it.

**A deleted line no longer keeps its cached bytecode.** The dependency graph
was pruned when a line was deleted; the LineCache was not, so entries for line
numbers that no longer existed accumulated until the whole cache was dropped on
a document switch.

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
- The API surface may still move before 1.0 proper.
