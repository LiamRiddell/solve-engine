# Engine iteration log

**Product goal**: build the SDK/engine that "destroys" the competition in this category —
SoulverCore, Numi, Notes Calculator, Numbr, NumPad, Calculo, and whatever comes next. Not a
one-time feature-parity pass: a standing practice of researching what these apps do, honestly
assessing what this engine can and can't already do, closing the gaps that are tractable now,
and recording — in markdown, kept current, not left to rot — exactly what's blocked and why for
everything that isn't. `packages` is the mechanism; the engine underneath it, its speed, and its
extensibility are the actual product.

This file is the **narrative log** — one dated entry per research/build iteration, short, linking
out to the detailed artifacts rather than duplicating them. It answers "what happened, in what
order, and why" for a future session or reviewer; the linked docs answer "what's the exact,
current status of feature X."

**Companion documents** (the detailed, kept-current status — read these for specifics, not this
file):
- [SOULVERCORE_FEATURE_AUDIT.md](./SOULVERCORE_FEATURE_AUDIT.md) — SoulverCore, page-by-page.
- [OTHER_APPS_FEATURE_AUDIT.md](./OTHER_APPS_FEATURE_AUDIT.md) — Numi, Notes Calculator, Numbr,
  NumPad, Calculo (inaccessible) — includes the three confirmed, unimplemented engine
  limitations with root causes and design sketches (cross-line data access, user-defined
  functions, dynamic unit-ratio reconfiguration).
- [ARCHITECTURE.md](./ARCHITECTURE.md) — the engine's actual structure, the SDK extension points
  (§5.1-5.2), and the standing punch list of architectural debt (§12).

---

## 2026-08-01 — SoulverCore feature-parity pass

Full page-by-page audit against SoulverCore's documentation site (all Documentation +
Syntax Reference pages). Result: 39/40 calculation features implemented across new/extended
packages (`time`, `conditionals`, `converters`, `mathphrases`, `finance`, `weather`, `stocks`,
`knowledge`, plus completions to `datetime`/`uom`/`arithmetic`), 1 deliberately deferred
(totals-and-subtotals' cross-line aggregation — see the engine-limitations writeup below, since
it turned out to be the SAME root cause several later apps also hit). Four new SDK extension
points shipped along the way, each because a real package needed it, not speculatively:
`PhrasePattern`, `createQueryResolver`, `IEnginePackage.asConverters`,
`LexerVocabulary.rawLinePatterns`. Full detail: [SOULVERCORE_FEATURE_AUDIT.md](./SOULVERCORE_FEATURE_AUDIT.md),
[ARCHITECTURE.md](./ARCHITECTURE.md) §5.1.

**Process lesson, not a feature**: `isolation: "worktree"` doesn't isolate `packages/core` when
it's uncommitted (a git worktree only ever contains committed content) — three parallel agents
ended up mutating the same shared checkout with no real filesystem isolation, and independently
collided on the same `CALL_BUILTIN` plugin-function indices twice. Fixed by hand during merge;
directly motivated the package-compatibility-checker work below, since that exact collision
class (two packages claiming the same numeric index) is now caught automatically at `error`
severity the moment either package is registered, instead of requiring a human to notice during
a merge.

## 2026-08-01 — Numi, Notes Calculator, Numbr, NumPad, Calculo

Same audit method, extended to the wider "calculator notepad" category beyond SoulverCore
specifically — Numi and Notes Calculator first (both have real, exhaustive public syntax
references), then Numbr and NumPad added mid-pass at the user's direction, Calculo attempted
but its only documentation-shaped URL (`/templates`) returns HTTP 403 (noted as inaccessible,
not silently skipped).

**Shipped** (nine items, all using existing engine primitives — no new VM surface area needed):
octal literal input (`0o17`; hex/binary already worked, octal had zero handling anywhere),
`arcsin`/`arccos`/`arctan` long-form aliases, `root(n, x)`, `fact`/`factorial`, `KiB`/`MiB`/
`GiB`/`TiB` binary-prefix data units (the underlying `convert` package already knew these
natively — a pure lexer-allowlist gap), three percentage solve-for-the-unknown forms (`N% of/
on/off what is X`), and `¥`/`₽`/`₩` currency symbols. Full detail with exact file/line
references: [OTHER_APPS_FEATURE_AUDIT.md](./OTHER_APPS_FEATURE_AUDIT.md).

**Confirmed, NOT shipped — three real engine limitations**, each with a concrete root cause and
a design sketch (not a vague "not supported"), because forcing these through as a rushed
package-level addition would have produced something broken or misleading:

1. **Cross-line data access** — blocks `prev` (Numi), `line<N>`/ranges (Notes Calculator,
   NumPad — `sum(line 1 : line 4)`), and cross-line `sum`/`total`/`average` (Numbr, and
   SoulverCore's own totals-and-subtotals from the earlier pass). **Confirmed by FOUR
   independent apps** wanting the exact same missing primitive — by a wide margin the
   highest-leverage single architecture investment identified so far. Root cause:
   `pluginFunctions` handlers have signature `(args: Value[]) => Value`, zero execution
   context (no line number, no `DocumentModel` access). Design sketch: an optional
   `LineExecutionContext` threaded through `CALL_PLUGIN`'s dispatch, sourced from
   `DocumentModel.getLineAt()`. Effort: MEDIUM.
2. **User-defined, parameterized, reusable functions** (Notes Calculator: `f(x) = 2*x + 1`,
   then `f(5)` → `11`, composable — `double(double(5))`). Root cause: `BytecodeBuilder`
   compiles each line to ONE flat, single-use program; there's no concept anywhere of a
   named, reusable, parameterized sub-program with its own call frame (built-in functions
   are fixed-arity native JS closures, not user-authored bytecode). Design sketch: a new
   `CALL_USER_FUNCTION` opcode, a per-engine `{name -> {params, program}}` registry, and a
   minimal parameter-binding call-frame mechanism. Effort: LARGE — genuine new VM primitive,
   not a package built on existing extension points.
3. **Dynamic unit-ratio reconfiguration** (Numi: `ppi = 326` changes what `em`/`px` mean for
   the rest of the session). Root cause: the entire unit system is a static, module-load-time
   table; no assignment can mutate a unit's conversion ratio at runtime. Design sketch: a
   per-engine (never module-global — would reopen the L1 cross-instance-isolation gap,
   `ARCHITECTURE.md` §10) mutable ratio-override map, checked before the static tables.
   Effort: SMALL-MEDIUM, but LOW PRIORITY — no other app in this audit wants it.

## 2026-08-01 — Package compatibility checking (`api/PackageCompatibility.ts`)

Not a feature-parity item — a direct response to "packages should have load-up resiliency and
compatibility checks to detect issues with overlapping logic." Built `checkPackageCompatibility()`:
a pure, static function comparing one package's declared fields against every other registered
package's, across every collision-capable field `IEnginePackage` has (parselet token types,
phrases, `asConverters` names, `pluginFunctions` indices, lexer keywords/operators, async-resolver
namespaces, token categories) — returning a structured `error`/`warning`/`info` report. Wired into
`ExpressionEngine.registerPackage()` so it runs automatically on every registration (non-blocking,
matching this codebase's established warn-and-proceed convention), not just available as an
opt-in call a host has to remember to make. Full detail: `ARCHITECTURE.md` §5.2.

Directly motivated by two real incidents from the SAME session's earlier work: three parallel
agents independently claiming the same plugin-function index (now an automatic `error`), and the
currency package's real descriptor drifting out of sync with its own parallel test-harness helper
(a different, source-consistency bug class this checker does NOT catch — noted honestly in its
own module doc rather than overclaiming coverage). Verified with a regression guard that runs the
checker against the REAL, live `BUILTIN_PACKAGES` array (not just synthetic fixtures) and asserts
zero `error`-severity conflicts exist today.

**Open follow-up, not yet started**: this checker only runs at package-registration time and only
compares DECLARED fields. It cannot catch semantic overlap two packages don't declare in a
structured way — e.g. two packages both claiming a similar-sounding NATURAL-LANGUAGE phrase
that doesn't collide exactly (a near-miss, not an exact-string collision the `phrases` check
catches) would slip through. Worth a future pass once there are enough third-party packages in
the wild to make near-miss detection worth the false-positive-rate tuning it would need.

## 2026-08-01 — Calca research, the registration-drift bug class killed for good

**Calca** (`calca.io/reference`) turned out to be a different kind of product — full
symbolic-math/CAS (matrices, complex numbers, symbolic calculus, general equation solving), not a
natural-language numeric calculator like every other app audited so far. Explicit product
direction: chase 100% parity anyway, including consolidating `Vector2`/`Vector3`/`Vector4` into a
general matrix type and treating Calca's syntax as a floor, not a ceiling. Full 6-phase roadmap in
[OTHER_APPS_FEATURE_AUDIT.md](./OTHER_APPS_FEATURE_AUDIT.md)'s new Calca section. The single most
important finding from this research: `der()`/`taylor()`/`jacobian()`/`x => ...`/`map`/`reduce`
all reduce to the SAME missing primitive — user-defined, parameterized, callable functions
(originally surfaced from Notes Calculator, previously scoped as one nice-to-have among several)
— which reprioritizes it to Phase 1, the first concrete build in this roadmap, in progress now.

**A live, real bug class was found and killed structurally, not just detected**, while double-
checking the compatibility checker's own stated blind spot: three built-in packages (`finance`,
`uom`, `variables`) had their real `IEnginePackage` descriptor silently out of sync with a
parallel hand-written `register{Domain}Parselets()` test-harness helper — the exact class the
`currency` package hit earlier this session, now confirmed to have happened FOUR times total.
Per explicit direction ("fix this and make sure it never happens again"): rather than adding a
drift-detection test on top of the duplication, all 15 packages' hand-written registration
functions were deleted outright and replaced with one generic, descriptor-driven
`registerPackageForTesting(pkg, registry)` (`tools/testUtils.ts`) — 47 files touched (15 source +
32 test/benchmark/integration files), full suite re-run clean afterward (156 suites, 3384 tests),
confirming the swap silently fixed all three live drifts as a side effect (finance/uom/variables's
isolated specs now reach token types they silently couldn't before) with nothing relying on the
old unreachable behavior. A new `RegistrationPathParity.spec.ts` both re-verifies every package's
descriptor-vs-registered-token-type parity and scans the whole `packages/` tree to fail outright
if a future package ever reintroduces a bespoke registration function — this bug class is now
structurally impossible, not just monitored.

## 2026-08-01 — Cross-line data access ships (Phase 1 of the approved engine-limitations plan)

`prev` (immediately-preceding line's result), `line<N>`/`line N` (any earlier line by absolute
number), `sum`/`total`/`average(line X : line Y)` (range aggregation), and `total above`/`sum
above`/`average above` (aggregate back to the nearest blank line/heading) — confirmed by FOUR
independent competitor apps wanting the same underlying capability (Numi's `prev`, Notes
Calculator's `line<N>`, Numbr's `sum`-to-header, NumPad's `line<N>` plus range syntax). Shipped as
a new `packages/lines/` package: a `LineExecutionContext` optionally threaded through
`executeBytecode()`/`CALL_PLUGIN` down to plugin-function handlers, `ExpressionEngine.
setDocumentModel()`/`makeLineContext()` answering "what's line N's result" from the real
`DocumentModel`, and 7 new token types/2 normalizer rules/4 parselets/6 plugin handlers covering
the full trigger-word collision policy (bare `prev`; normalizer-fused `line<N>`; `sum(`/`total(`/
`average(` fused only when immediately followed by `(`, so `:sum = 100` and MathPhrases' existing
`"total of X, Y"` stay unaffected; `"total above"` phrase-fused rather than claiming the bare
`total`/`sum` keywords MathPhrasesPackage already regressed on once).

While regression-testing the "referencing an errored/pending line must give a clear error, never
a silently wrong number" requirement, found a real, pre-existing engine-wide gap: `vm/
VMConversion.ts`'s `binaryOp()` (the shared fallback every one of ADD/SUB/MUL/DIV/MOD routes
through for non-Number/Boolean/Datetime/Uom-rate operands) never checked for `ValueType.Error`/
`Pending` operands before computing — `Value.toNumber()` returns `0` for both, so `prev + 1` on an
errored line silently evaluated to `1` instead of propagating the error. `EXP` had the same gap
via its own separate path (`Math.pow()` on raw `toNumber()` output, never routed through
`binaryOp()` at all). Fixed at the operator level in both places — this closes the arithmetic-
level symptom of the still-open `ARCHITECTURE.md` §12 P0-1 item engine-wide, not just for
`packages/lines`.

## 2026-08-01 — User-defined, parameterized functions ship (Phase 2 of the same plan)

`f(x) = 2*x + 1`, then `f(5)` → `11`, composable (`double(double(5))`), works across units and
constants (`hyp(a, b) = sqrt(a*a + b*b)`, `circle(r) = pi * r * r`). The primitive identified as
the prerequisite for roughly half of Calca's remaining feature list (`der`/`taylor`/`jacobian`/
`x => ...`/`map`/`reduce`) — see `OTHER_APPS_FEATURE_AUDIT.md`'s Calca section.

`IDENT` is one of `PrecedenceParser`'s Tier-1 fast-path token types, hardcoded in its
`parsePrefix()` switch and returned from before the `ParseletRegistry` is ever consulted — so the
definition/call grammar (a new `findMatchingRParen()` plus `parseUserFunctionDefOrCall()`/
`parseUserFunctionDefinition()`/`parseUserFunctionCall()`) lives directly inside that switch, not
as a normal package parselet, mirroring `NumberParselet.ts`'s already-documented precedent for the
same reason. New opcodes `DEFINE_USER_FUNCTION`/`CALL_USER_FUNCTION` (150/151); a definition's
body compiles to its own independent `BytecodeProgram`, stored in a `BytecodeBuilder.
userFunctionBodies` side-table and registered into the VM's `userFunctions` map only when
`DEFINE_USER_FUNCTION` actually EXECUTES (not at parse time — a diagnostic/lookahead parse that
never executes a definition line has no side effect on the registry). Parameter references inside
a body compile to ORDINARY `LOAD_VAR` opcodes — no dedicated parameter-load opcode at all, since
`CALL_USER_FUNCTION` binds arguments into a name-keyed call frame (`Map<string, Value>`) and
`VM.getVar()` checks the innermost call frame before the flat variable store. This also means
`packages/variables/parselets/IdentifierParselet.ts` (the `UNIT`-token variable-read path — common
short parameter names like `h`/`l`/`b` collide with unit abbreviations and lex as `UNIT`, not
`IDENT`) needs no special-casing either: a bare `LOAD_VAR` is correct for every identifier read,
parameter or not.

Both `userFunctions` and the call-frame stack live ON THE VM INSTANCE (`createVM()`'s closure),
not a module-level registry — deliberately avoiding a new instance of the L1 cross-instance-
isolation gap `ARCHITECTURE.md` §10 already tracks. Three risks a rough sketch of this feature
would have missed, each closed with a dedicated regression test: (1) a recursion-safety gap —
`localInstructionCount` is fresh per `executeBytecode()` call, so `f(x) = f(x)`'s nested reentrant
calls would hit a native, uncatchable V8 stack overflow before `maxInstructions` ever caught it;
fixed with a dedicated `maxFunctionRecursionDepth` guard (default 50) in `pushCallFrame()`. (2) a
`VMCheckpointer` gap — `snapshot()` used to call `vm.getVar(name)` for every written name, which
silently returns `undefined` for a function name (function defs live in `vm.userFunctions`, not
the flat variable store), so a function defined above a scrolled-away viewport would vanish on
`restoreTo()` even though the document still showed its definition line as clean; fixed by adding
a separate `functions: Record<string, UserFunctionDef>` bag to `VMCheckpoint`. (3) a DAG
parameter-shadowing gap — `ExpressionEngineSafety.ts`'s `extractReadsAndWrites()` needed its own
bracket-matching pre-scan to detect `name(params) = body` as a write of `name` AND exclude the
declared parameter names from reads/writes entirely, or `f(x) = 2*x+1` would spuriously depend on
any unrelated `:x` elsewhere in the document.

v1 scope decisions, disclosed rather than silently gapped: parameter names are bare `IDENT`/`UNIT`
only; no `:x = ...` assignment statements inside a body (bodies are pure expressions); a body
whose compiled `BytecodeProgram.hasAsync` is `true` (calls a weather/stocks/currency-style plugin
function) is rejected at DEFINITION time with a clear `FUNCTION_BODY_MUST_BE_SYNCHRONOUS` error —
propagating a `'pending'` result up through a reentrant `executeBytecode()` call would need the
OUTER expression's own bytecode position/stack state to also be resumable later, which this pass
doesn't implement.

One reintroduction of the registration-drift bug class described earlier in this file was caught
and fixed the same way as the others: `packages/lines` had grown its own bespoke
`registerLinesParselets()` — `RegistrationPathParity.spec.ts` caught it immediately, confirming
the structural guard from the earlier iteration actually works against new code, not just the
packages that existed when it was written.

Also found and fixed while verifying the shipped `packages/lines` playground example gallery:
neither `playground-bridge`'s `runEngine()`/`runEngineWithStreaming()` (the actual live-playground
evaluation paths) nor `PlaygroundExamplesValidity.spec.ts`'s own validation loops ever wired an
`ExpressionEngine` to a `DocumentModel` — meaning cross-line references would have errored with
"no document" in the live demo despite working correctly in the real Obsidian plugin (whose
CodeMirror integration already uses `ThreeTierEvaluator`/`DocumentModel` properly). Fixed by
setting each evaluated line's result directly on the `DocumentModel`'s live `LineState` object in
all four places — the one field `getLineResult()`/`isLineBoundary()` actually read, without
needing the heavier incremental-caching bookkeeping (`updateLineResult()`) `ThreeTierEvaluator`
owns and this simpler debug harness doesn't use.

Verified via the full four-command gate (`tsc --noEmit --skipLibCheck`, full `jest --no-coverage`
— 162 suites, 3580 tests, 0 failures, `tsup`, production `esbuild`) after each phase.

## 2026-08-01 — Engine-version package compatibility gating

A real gap in the public SDK, distinct from `PackageCompatibility.ts` (§5.2): that checker only
ever asks "do two SIMULTANEOUSLY-registered packages' fields collide," always advisory, never
blocks. It has zero notion of TIME — a third-party package built against an old `@solve/core`
release, loaded into a much newer engine whose `IEnginePackage` contract has since changed shape,
registered with no signal at all. New `IEnginePackage.engineVersion?: string` (a semver range,
e.g. `"^0.1.0"`), checked via the standard `semver` package against a new, real `ENGINE_VERSION`
constant (`constants/version.ts`, a build-time JSON import of this package's own `package.json` —
nothing like it existed before this pass). `api/EngineVersionCompatibility.ts`'s
`checkEngineVersionCompatibility()`/`assertEngineVersionCompatible()` are deliberately a SEPARATE
module from `PackageCompatibility.ts`, not an extension of it — an unsatisfied or malformed range
is a hard REJECTION (`PACKAGE_ENGINE_VERSION_MISMATCH`/`PACKAGE_ENGINE_VERSION_INVALID_RANGE`,
both `ErrorCategory.CONFIG`), the one deliberate exception to this codebase's otherwise-consistent
"warn and proceed" convention for package-registration signals — folding a genuinely-blocking
check into §5.2's always-advisory report type would have misled a future reader. Wired as the
literal first statement in BOTH `ExpressionEngine.registerPackage()` and the weaker
`PackageRegistry` singleton's `registerPackage()` (which had zero compatibility checking of any
kind before this — otherwise a trivially bypassable gate), and specifically before the
duplicate-name/unregister guard, so rejecting an incompatible "upgrade" never tears down an
already-working package first. `engineVersion` is optional; every package that predates this field
(all 16 built-ins, `examples/osrs`) keeps registering unchanged — `examples/osrs` was updated to
declare `"^0.1.0"` purely as a canonical worked example for future package authors reading it.

**Honest, disclosed limitation, not solved here**: this gate's long-term value depends on
`package.json`'s `version` actually getting bumped in step with real `IEnginePackage`/
advanced-public-tier breaking changes — a discipline this repo does not yet practice (see
`ARCHITECTURE.md` §5.3's closing note). This pass builds the mechanism; making version bumps
actually happen going forward is a separate, unstarted process change.

## 2026-08-04 — A real computer-algebra system, with exact rational coefficients

Shipped on `feat/symbolic-cas` as five sequential commits: the core, the canonical polynomial
form, factoring, solving, and calculus. See [`syntax/algebra.md`](../docs/src/content/docs/syntax/algebra.md)
and [`syntax/calculus.md`](../docs/src/content/docs/syntax/calculus.md) for the user-facing surface.

**This reverses a decision.** [`OTHER_APPS_FEATURE_AUDIT.md`](./OTHER_APPS_FEATURE_AUDIT.md)'s Calca
roadmap committed to *numerical approximation* for `der`/`taylor`/`jacobian`/`x => ...`, on the
reasonable ground that a real CAS is a large undertaking and finite differences reuse the existing
bytecode VM. Polynomial **factoring** is what forced the revisit: `factor(x^2-4)` has to produce
`(x-2)*(x+2)`, which no numerical method can. Once the tree and exact arithmetic exist for that,
symbolic differentiation turns out to be *easier* to get right than finite differences (no step
size to trade truncation against rounding), and exact quadratic roots fall out of the same
representation. The old paragraph is kept in place with the reversal noted above it, per this
folder's own convention.

**The gap was bigger than "we do not factor".** `SymbolicNode` had no `pow` node and no
function-application node, and `Value.toNumber()` reports `0` for a symbolic operand by design. Any
opcode reaching for `.toNumber()` without checking `.isSymbolic()` therefore computed with zero and
returned a confident, error-free, wrong answer: `x^2+3x+2 =>` was returning `3x+2`, `-x =>` was
returning `-0`, and `sqrt(x) =>` was returning `0`. Three silent wrong answers, sitting in a
shipped feature, none of which any test caught because no test asked.

**Why exact rationals, concretely.** The rational-root theorem tests a candidate by evaluating the
polynomial there and asking whether the result is zero; in floating point a near miss and a true
root are indistinguishable, so factoring and exact solving are simply not available on doubles.
Exactness also closed a live bug in already-shipped code: `MatrixOps` compared pivots with `=== 0`
on a double, so a structurally-zero pivot arriving as `5.551e-17` made a singular symbolic matrix
look invertible. `rationalFromNumber` converts through the decimal string rather than the IEEE
expansion, so `0.1` is `1/10` and not `3602879701896397/36028797018963968`.

**Where it lives, and why that mattered.** `src/symbolic/` is the pure-mathematics core;
`src/packages/symbolic/` is grammar and registration only; `src/vm/SymbolicOps.ts` is the one
module that legitimately knows both `Value` and `SymbolicNode`. The core cannot sit inside
`packages/`, because `vm/Value.ts` already embeds a `SymbolicNode` in its value union and in
`MatrixEntry`, and a package may import from `parser/` but never the reverse.

**Structural guard.** `SymbolicSurfaceParity.spec.ts` is driven from one table in
`SymbolicPackage.ts` and checks, per verb, that the normalizer's token type has a registered
parselet, that the builtin index has a live implementation, that the word still works as an ordinary
variable name, that all three public entry points agree, and that the documented example sits in a
runnable ` ```solve ` block. It caught two genuine wiring bugs while being written, including the
VM's symbolic interception swallowing `expand()` before it could receive the very expression it
exists to take.

**Property tests did the real verification.** Expanding a factorization reproduces the input;
substituting an exact root gives exactly zero; differentiating an integral returns what was
integrated. Each of those caught a bug that hand-written cases had missed, including a guard that
treated `(x-1)^2` as unfactored and a formatter that rendered `3*(2*x)` as `32x`.

**Deliberately not done**, each reported rather than approximated: complex numbers (so a negative
discriminant says "no real solutions" and `x^2+1` stays unfactored), Cardano for a cubic with no
rational root (its *casus irreducibilis* needs complex intermediates, so those take the documented
numerical fallback), multivariate factoring beyond content and common-monomial extraction,
polynomial GCD and rational-function simplification.

**Late addition, same day**: the bare `x^2-4=0` then `x =>` stored form, initially deferred because
a bare `=` is already claimed by three shipped grammars and `trySymbolicGrammar` runs before the
parser, so a pattern match there can swallow a working feature silently. The exclusion that mattered
was the user-function definition (`f(x) = 2*x`), which reaches the same code path because
`parseFactorChain` declines it too. Writing its documentation then exposed a real gap in the older
matrix path: `a*n = 10` with a numeric `a` matched the product-chain shape and reported "must be a
Matrix" for a line with a perfectly good answer, so a chain now stores both equation kinds and falls
back to the scalar solver on exactly that error.

**Rode along**: `scripts/bench-baseline.mjs` was missing `--experimental-vm-modules`, which the
`bench` script passes. mitata is ESM-only and lazily imported, so every measuring suite threw while
the run still wrote the baselines it was meant to produce, quietly turning the reference data into
garbage. A gate nobody has watched fail is not known to work, which this folder already knew.

## 2026-08-04 — Finishing the CAS (`feat/cas-complete`)

`feat/symbolic-cas` shipped a real CAS with a list of stated limitations. This iteration closed
that list. Every item below was previously documented as "deliberately not done"; the entry above
is left as written, because it records what was true and why, which is this folder's convention.

**Complex numbers, and the order that forced.** Exact Gaussian rationals (`Complex.ts`), so
`x^2+1=0` gives `-i` and `i` rather than "no real solutions", and `sqrt(-4)` is exactly `2i`. This
had to come first, and not for tidiness: a cubic with a negative discriminant is solvable in
radicals only through the cube roots of a complex number, so exact cubics were blocked on it.

**Polynomial GCD** (`Gcd.ts`), which `cancel()` exposes and which partial fractions and rational
integration are both built on. `(x^2-1)/(x-1)` reduces to `x+1`.

**Closed-form cubics and quartics** (`CubicQuartic.ts`). Cardano covers every cubic; quartics are
covered when biquadratic or when the resolvent cubic splits them into two rational quadratics. The
*casus irreducibilis* stays numeric **and stays a stated limitation**, because its three real roots
provably have no expression in real radicals — that is a theorem, not a gap in effort, and the
trigonometric form that does exist is a cosine of an arccosine of an irrational that nothing
downstream could use.

**Partial fractions and rational integration** (`PartialFractions.ts`). `apart()` is new, and
`integral()` now handles any rational function whose denominator has no repeated irreducible
quadratic factor. The coefficients come from an exact linear solve rather than the cover-up method,
because one Gaussian elimination covers distinct linear factors, repeated ones and irreducible
quadratics, where cover-up needs separate machinery for each.

**Multivariate factoring** (`MultivariateFactor.ts`), by pattern rather than by algorithm, and the
module says so: difference of squares, sum and difference of cubes, perfect-square trinomial, and
four-term grouping.

**What the property tests caught this time.** Roots verified by substitution over the complex plane;
decompositions verified by recombining over the original denominator; factorizations verified by
expanding. Real bugs found: `surdNode` built a `Rational` as a literal rather than through
`rational()`, so an unreduced `6/108` escaped normalization the first time a Cardano root exercised
it; a biquadratic reported four roots where a repeated inner solution gave two;
`factorUnivariate` leaves `x^3-x` unfactored because the rational-root theorem has no candidates at
all when the constant term is zero.

**Rode along.** `CONJ_FN`, `RE_FN`, `IM_FN`, `CANCEL_FN` and `IMAGINARY` were never declared in
`Token.ts`, though its own comment says every token type a built-in package relies on belongs
there — the same lazily-minted-id drift that has already bitten once. And a sum whose right side was
a product with a negative leading coefficient rendered `0.5*log(x-1)+-0.5*log(x+1)`; the sign is
lifted in the formatter now, for `mul` and `div` only, since for a `pow` a leading minus belongs to
the base.
