# Cross-scope cells — design specification

> Written 2026-09-21, from a multi-agent audit of the global-variable subsystem and two rounds of
> competing designs. Supersedes nothing; this subsystem has never had a written design.
> **Status: SPECIFIED. Release A shipped (PRs #490 to #493), Releases B onwards not started.**
> Release A depended on nothing in this design, which is why it went first.

## Why this exists

`global :name` is the only cross-document mechanism the engine has, and it does not record which
document a value came from. `GlobalVariableStore` is a realm-wide `Map<string, Value>` keyed on the
bare name, with last-write-wins semantics its own comment states plainly: "any document may call
this for any name at any time". Two documents writing `global :total` silently clobber each other,
and no reader can tell which one won, because no provenance is stored anywhere.

The maintainer's framing: a global whose source you cannot name is not useful.

## The two product decisions this is built on

Both were decided deliberately and neither is open.

1. **A cross-scope reference is a CELL REFERENCE**, addressed at the point of use: "the value named
   N belonging to scope S". It is not a workspace-wide constant resolved by name alone. There is
   therefore no "resolve to whichever scope happens to export it" rule to design, and no ambiguity
   rule to get wrong.
2. **WRITE LOCALITY.** A program executing under scope S may write only cells owned by S. Every cell
   has exactly one possible author by construction, so last-write-wins races and ambiguous-owner
   errors cease to exist as a category.

Changes propagate: when a cell's value changes, every reader re-evaluates, wherever it lives.

## What a scope is, and what it is not

A scope is an opaque handle **minted by the workspace**, not supplied by the host:
`registerScope(): ScopeId`. The host keeps its own mapping from whatever it considers a document to
that handle. The engine never receives a host identifier, never interprets one, and acquires no
vocabulary for what a document is.

This matters more than it looks. The published surface promises "No dependencies on a UI framework,
a DOM, or an editor", and one host's world-model is already inside `BUILTIN_PACKAGES`:
`packages/datetime/normalizer/DailyNoteLinkNormalizerRule.ts` recognises `[[...]]`, and its own doc
comment names the editor it belongs to. That is a pre-existing violation worth correcting
separately, and it is the exact outcome this design is shaped to avoid repeating.

## The model

### Storage

A host-constructed `Workspace` that outlives every engine attached to it, replacing the module
singleton. Cells are a two-level `Map<ScopeId, Map<CellName, CellRecord>>` rather than a composite
string key, so the read path does no string building.

Removing `sharedGlobalVariableStore` is not incidental. `EngineContext.ts` documents an in-flight
migration away from module-level singletons precisely because "Two ExpressionEngine instances in one
process could not be isolated from each other", and this store is the one place that defect is still
unaddressed. Its own comment calls itself "the one deliberate exception", which contradicts the
stated migration direction. One of the two is wrong, and it is this one.

### Write locality is structural, not checked

A qualified write is a syntactic shape, recognisable from tokens alone before any scope is known, so
it is refused at parse time. The consequence is the point: **no instruction capable of naming a
foreign scope ever exists in the instruction set**. `STORE_GLOBAL_VAR` can only write
`(context.scope, name)`. Locality then holds by construction rather than by validation, and the only
runtime check left is whether a scope is present at all.

### The executing scope rides the line context

`LineExecutionContext` already reaches the dispatch loop and is already live at both cell opcodes
(`VM.ts:3115`, `:3141`), which ignore it today. Neighbouring cases read it, and it is forwarded
through every re-entrant `executeBytecode` call, so a cell write inside a user-defined function
inherits the scope with no extra work.

Three hazards, all of which need explicit handling:

- `makeLineContext` returns **one shared object mutated per pass**. A scope must be set by mutation
  alongside `lineIndex`, and any handler retaining the context across a scope change reads a stale
  scope. The goal-seek re-entry already sidesteps exactly this by allocating its own.
- `AsyncResolutionBatcher`'s main-thread re-execution **builds its context by hand as a
  three-field object literal**, and that path re-executes lines that WRITE. A field added elsewhere
  is silently absent here, which is precisely where a missing scope mis-attributes a cell.
- The worker runtime calls `executeBytecode` with **no context at all**, in a separate realm with its
  own store. Latent while no host registers a worker factory, and a correctness bug the moment one does.

`warmUp` also executes without a context and must tolerate the invariant, or be given the anonymous
scope.

### The DAG key must stay text-derived

This constraint binds the whole design and is easy to violate.

Bytecode is cached by raw expression text, **and so is the extracted read/write key set**. The same
cached program and the same cached keys are reused under whatever scope is currently wired up. So
parse-derived cell keys must stay scope-free at extraction and be qualified later, at
`registerLineWithTags`, which runs under a known scope. Qualify them at extraction and the front-half
cache hands one scope's keys to another.

There is a second reason the keys must be text-derived rather than execution-declared. `dag.clear()`
fires on **every** structural edit. Text-derived edges are rebuilt for every line at every tier;
execution-declared edges return only for lines that actually run, and Tier 3 executes only lines that
write. A design whose dependency edges are declared at execution time therefore goes silently stale
for a non-writing read line that is off-viewport. This is what disqualified an otherwise attractive
"scope handle as an ordinary function call" spelling.

### Propagation is a buffered atomic commit

A pass stages its cell writes into a per-pass batch, and the workspace publishes them as one change
set **after** `disableValueArena()`.

This is the highest-value mechanism in the design and it costs a host no vocabulary at all:

- mid-pass cell state stops being observable from another scope;
- delete-and-re-add within one transaction, and undo, stop flapping readers, because only the net
  state of the transaction is published;
- cycle detection gets exactly one place to run;
- the notification callback moves outside the arena window, so a host scheduler may legitimately
  drive other scopes' passes from inside it. Today `STORE` notifies synchronously from inside the
  dispatch loop, which forbids that.

One correction to note during implementation: `settleOrphanedNames()` is called **inside** the arena
`try` block, not after it. Settling stays where it is and stages retractions into the batch; only the
commit moves out.

### Cycles

Cross-scope cycles are reachable the moment decision 1 is taken, and they are invisible today. Both
cycle walks skip prefixed keys (`ThreeTierEvaluator.ts:795` and `:901`) on a stated rationale that
decision 1 falsifies:

> Only variable names among the keys: a tag, a global or a data source is not a line's answer, and a
> cycle cannot run through one.

The answer is a cycle ledger in the workspace whose **vertices are cells**. Not scopes, which would
report false cycles for independent chains that happen to cross. Not lines, which cannot cross an
engine and name nothing a reader can act on. Each scope publishes, per cell it declares, that cell's
transitive intra-scope cell closure; Tarjan runs in the workspace only when the cell edge set changes.

A staged write to a cell in a non-trivial strongly-connected component is **refused**, and the fault
is published in the same commit, so no reader ever observes a number that a cycle produced. That is
"an error, never a guess" applied to the case the engine currently has no answer for.

The generation gate is mandatory, not an optimisation. Because `dag.clear()` fires on every
structural edit, a scope may publish its summary only once its whole document has re-registered since
that clear. Until then its verdict is **UNKNOWN, never "no cycle"**. Note the timing this implies: a
newline is exactly how a cross-scope reference gets typed, so the verdict is briefly UNKNOWN at
precisely the moment one is being written. Whether a brief UNKNOWN is acceptable, or must be
distinguishable in the UI from a settled answer, is an open question below.

### Host API

```ts
export function createWorkspace(options?: {
  /** Maps an opaque reference token to a registered scope. Pure; memoised by the workspace. */
  resolveReference?(from: ScopeId, token: string): ScopeId | undefined;
}): Workspace;

export interface Workspace {
  registerScope(): ScopeId;            // minted, never supplied
  unregisterScope(id: ScopeId): void;  // one commit tombstoning every cell it owns
  isRegistered(id: ScopeId): boolean;

  read(scope: ScopeId, name: string): CellState;
  declarations(scope: ScopeId): ReadonlySet<string>;

  onScopesDirty(cb: (scopes: readonly ScopeId[]) => void): () => void;
  onCycle(cb: (path: readonly CellRef[]) => void): () => void;
  degraded(): readonly ScopeId[];
  staleScopes(): readonly ScopeId[];
}

export type CellRef = { scope: ScopeId; name: string };
export type CellState =
  | { kind: "value"; value: Value }
  | { kind: "pending" }
  | { kind: "fault"; code: CellErrorCode; value: Value }
  | { kind: "unknown" };
```

The precedent to match is `CalendarBackend`: total, stateless, no lifecycle, no callbacks,
impossible to half-implement. The failure to avoid is `IVariableSource`, removed in 2.0.0 because it
"registered into a resolver no evaluation path ever queried". **Any new host seam must be called from
the core evaluation path in the same commit that introduces it, and exercised by two independent
hosts before it ships.** An interface that looks implementable and is implemented shallowly is worse
than no interface, because nothing can validate it from inside the engine.

## The spelling

Decided separately, and deliberately minimal. The engine ships exactly one neutral form, built
entirely from tokens that already lex:

```solve
global :total from "reports/q3"
```

`GLOBAL`, `COLON`, `IDENT`, `FROM` and `STRING` are all live; `from` is already a claimed keyword;
the parselet already hand-consumes multi-token grammar. **Zero lexer changes, zero `IEnginePackage`
extension, zero new tokens.** The string is opaque text the engine hands to `resolveReference` and
never interprets.

A host that wants its own spelling can have one without any engine extension. A pure declaration line
is a whole line of literals with no expression, which is exactly the granularity
`LexerVocabulary.rawLinePatterns` already serves, and that hook is package-reachable with a shipped
consumer in the knowledge package. The engine's neutral form still parses on the same line.

The polarity is deliberate and was got wrong in an earlier round: **the neutral form is the base and
the host form is additive.** Neither is labelled a fallback.

## Shipping order

| Release | Contents | Breaking |
| --- | --- | --- |
| **A** — 2.38.x patch | The independent defects below. No design decision, no API change. Shipped: PRs #490-#493. | No |
| **B** — 2.39.0 | Internal seams only: scope and cells on `LineExecutionContext`, per-engine anonymous scope, staging structures. No observable behaviour change. | No |
| **C** — folds into 3.0.0 | Cell retraction, intra-scope only. | Yes, user-visibly |
| **D** — 3.0.0 | `GlobalVariableStore` becomes `Workspace`. `sharedGlobalVariableStore` export removed. | Yes, the major |
| **E** — 3.0.0 or 3.1.0 | Cross-scope cycles: ledger, generation gate, refusal-on-commit. | Additive API |
| **F** — unscheduled | A host-supplied provider for cells whose owning scope is not resident. Must be a pair (`load` + `watch`) if ever built. | Additive |

Do **not** ship an engine-level config lever to soften the semantic break. The only external host is
pinned many minors back, so no shipped user can be broken by an engine release; the break is a single
event that host controls during its own upgrade. A permanent config field to soften a one-time break
is a dead field with a configuration surface, which this repo's own configuration notes call worse
than no limit at all.

## Release A — defects that need no design decision

Each was independently verified against HEAD. Every fix below was proven by reverting the source
change alone and confirming its tests fail without it.

1. ✅ **`formatValue` has no `Pending` case.** A pending value's payload is its dedup query key, so the
   default branch rendered it as the answer: `= global:total`. Same leak as the `Error` case
   directly above it, which carries a comment recording the identical fix. **Fixed, PR #490.**
2. ✅ **`MAX_NOTIFY_DEPTH` is a silent-corruption path, not a safety net.** `set()` stored the value and
   then called `notify()`, which returned at the limit **before** invoking any listener, so the store
   held a value every reader was permanently never told about. The bound is now checked before the
   write, so the store and its readers cannot disagree. It remains unreachable from engine code, both
   engine-side listeners being non-reentrant, so it is not the cycle bound it appears to be.
   **Fixed, PR #491.**
3. ✅ **The only cross-document cycle test passed vacuously.** It wrote the received value straight
   back, so the second hop hit the unchanged-value short-circuit and the recursion stopped at depth 2
   without reaching the bound it was named for. It now varies the value per hop, asserts the engine's
   bound rather than the test's own guard terminates it, and asserts every stored value was announced.
   **Fixed, PR #491.**
4. ✅ **`sameValue` was wrong in both directions.** Its `Array.isArray` branch tested the payload
   itself, which is never an array: the arrays are a level further in, as a matrix's `data`. So every
   object-valued cell fell to `Object.is` on a freshly built object and re-notified on every pass, for
   ever. Found while fixing it: the comparison also skipped every sidecar, so `1.5` and `1.5 to 2 dp`,
   or `30` and `30 ± 2`, compared equal and suppressed the notification, leaving readers rendering the
   old value with no event that would correct it. That direction is the worse one, because a missed
   notification is permanent. The payload walk is now bounded and reports not-equal when it cannot
   finish. **Fixed, PR #491.**
5. ✅ **`GlobalVariableAsyncResolver.preflight` returned at the first unresolved reference**, so a line
   with N unresolved cell reads cost N serial pend-and-re-execute round trips. It now collects every
   miss in the scan it already performs and waits on all of them together, deduplicated and ordered.
   **Fixed, PR #492.**
6. ⛔ **The resolver is constructed at module scope** inside the variables package, so one
   bare-name-keyed pending map is shared by every engine in the realm that registers it.
   **Deliberately not fixed. Do not fix it in isolation.**

   The impact is smaller than it looks: the map is keyed by name, the store beneath it is realm-wide
   anyway, so a promise for a name is correct whichever engine asked. The only real coupling is
   `destroy()` clearing the shared map, which costs a transient duplicate subscription rather than a
   leak, since subscriptions self-remove on resolve.

   The fix is not small. Per-engine resolver instances require either making `VARIABLES_PACKAGE` a
   factory, which breaks package identity, or changing `IEnginePackage.asyncResolvers` to take
   factories rather than instances, which changes the shape every package author writes against.
   Package identity is a documented public contract: `BUILTIN_PACKAGES.filter((p) => p !==
   CURRENCY_PACKAGE)` appears in both the README and the security guide as the supported way to drop a
   package. Either route is a major-version change to buy back a transient duplicate subscription.

   Release D removes the shared store, at which point cells are workspace-scoped and this stops
   mattering on its own. Fix it there, as part of that, or not at all.
7. ✅ **`evaluateDocument` left the batcher's checkpointer behind** despite a comment promising it left
   nothing. The checkpointer is what the async batcher uses to restore VM state when a value lands
   later, keyed by line position, so a host's async results were restored from checkpoints belonging
   to a document that no longer existed. **Fixed, PR #493.**
8. ⏸ **Retraction is absent.** Deleting the line that wrote a cell never withdraws its value, because
   `forgetOrphanedNames` skips every prefixed key. Only sound to fix once writes are owner-keyed, so
   it belongs to Release C rather than A. Listed here because it is the defect users would describe
   first.

## Open questions

These need judgement rather than more code reading.

- **Non-resident scopes.** Decision 1 implies `(S, total)` means the same thing regardless of what is
  resident, which argues the provider is mandatory rather than deferred. The counter-argument is that
  a pull model's missed invalidation is permanent, where the push model is eagerly redundant and
  self-heals. Release F is currently deferred on the strength of the second argument. This is the
  most consequential open question in the document.
- **`onScopesDirty` is correctness-critical but shaped like telemetry.** A host that never subscribes
  serves stale numbers for ever, in every scope it does not drive, with every individual call it made
  correct. Neither the types nor the engine can compel the subscription.
- **Should a read spell the same as a write?** `global :total = 1200` and `global :total from "b"`
  are now genuinely different operations, and a distinct read verb costs nothing.
- **The UNKNOWN window.** Whether a briefly-unknown cycle verdict needs to be distinguishable from a
  settled one, given a newline is how a cross-scope reference gets typed.
- **Scope re-identification.** `resolveReference` is memoised and parse-derived keys carry the
  reference text, so a host re-identifying a scope must invalidate every reader's key and every
  cached front half for those lines.
