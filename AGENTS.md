# AGENTS.md

Working notes for anyone changing this codebase, human or agent.

This file is kept accurate against the implementation. If a claim here is wrong,
fix the claim rather than working around it. Several of the rules below exist
because something specific broke, and the reason is given each time so you can
judge whether it still applies.

## The gate

```bash
npm run verify
```

Type check, full test suite, package build, and a smoke test that imports the
built package the way a consumer would. Continuous integration runs this exact
script, so the two cannot drift.

Run it before claiming a change works. For a tight loop, `npm run test:light`
skips the fuzz and long-document suites; the full run is still the gate.

## Layout

| Path | Contents |
| --- | --- |
| `packages/engine` | The published package, `solve-engine` |
| `packages/playground-bridge` | Shared glue between the engine and the playground |
| `playground` | Interactive playground, own lockfile, not a workspace member |
| `docs` | Documentation site, own lockfile, not a workspace member |
| `docs-internal` | Maintainer notes, not published |
| `examples/osrs` | A worked third-party package |

Inside `packages/engine/src`, evaluation flows `lexer` to `normalizer` to
`parser` to `vm`, with `engine` orchestrating and `packages` supplying all the
actual language features. `ARCHITECTURE.md` in that directory is the long
version, including a running list of known gaps.

Source refers to itself through the `@solve-js/*` alias, never through the
published name. That is why renaming the package stayed a one-line change.

## Errors

This is the authoritative account. Two older documents described a `SolveError`
type and a per-category recovery-strategy dispatch that were never implemented.
Do not reintroduce either.

### The type

`EngineError` carries a `category`, a `code` from the checked catalog, a short
stable `message`, optional `expected`/`found`/`suggestion` detail, a
`recoverable` flag, an optional source `span`, readonly `context`, and a
`cause`.

`.message` is what tests assert on and what the inline result display shows.
Keep it short and stable. `.format()` is the multi-line version for stack
traces and diagnostic panels. Do not conflate them.

Live in `packages/engine/src/errors/`: `EngineError.ts`, `Result.ts`,
`ErrorCode.ts`. `UnifiedErrorFramework.ts` is a re-export barrel kept for the
hundred-odd call sites that import from it. Import from either path, do not
invent a third.

### Constructing one

`ErrorFactory` has six methods. The `recoverable` default follows from the
category.

| Method | `recoverable` | For |
| --- | --- | --- |
| `.parsing()` | true | Lexer and parser failures, malformed syntax |
| `.validation()` | true | Input rejected by a safety check |
| `.execution()` | true | VM failures reachable from valid-looking input |
| `.external()` | true | A third-party API or network call failed |
| `.internal()` | false | An engine invariant was violated. A bug |
| `.config()` | false | A registration or host-configuration problem |

**`recoverable` means "user error" versus "engine invariant violation", and
nothing else.** It is not a dispatch table, and it does not decide whether the
rest of the document keeps evaluating. Per-line containment means everything
else always continues regardless. The flag exists for message framing and
telemetry: "fix your syntax" versus "this is worth reporting".

The test: could a user hit this by typing a plausible but wrong expression? Then
parsing, validation, execution or external. Could it only happen if another part
of the engine already broke its own contract? Then internal or config.

### Adding a code

For core layers, add it to `CoreErrorCodes` in `errors/ErrorCode.ts` with a
one-line comment saying what triggers it, then run
`__tests__/errors/ErrorCodeCatalog.spec.ts`. That test enforces uniqueness and
scans for codes used but never cataloged, which catches typos immediately.

Domain packages under `src/packages/*` are deliberately outside the core
catalog, because `IEnginePackage` is public SDK surface and a closed enum would
stop a third-party author defining their own codes. Export a co-located
`XxxErrorCodes` const instead, following `WeatherErrorCodes` or
`CurrencyErrorCodes`. Those are not orphan-checked, so check the string by hand.

### Never `throw new Error`

There is exactly one raw throw in `packages/*/src`, the build-configuration
sentinel in `workers/engine.worker.ts`, and its doc comment explains why it
stays raw. Everything else goes through `ErrorFactory`. A bare error loses the
code and category that let a host tell a user typo from an engine fault.

### Contain failures per item

**Any loop over document lines or batch items must contain each iteration's
failure and continue.** This is the most important rule here. Two confirmed
crash bugs had exactly this shape:

`AsyncResolutionBatcher.reExecuteMainThread()` looped over resolved async lines
calling `executeBytecode()` with no try/catch in the chain, inside a bare
`queueMicrotask` where no caller could catch anything that escaped. One line
failing could drop every later line, or take down the host process.

`ExpressionEngine`'s constructor looped over packages calling
`registerPackage()` with no try/catch. One package whose vocabulary collided
with a built-in threw straight out of the constructor, so `new
ExpressionEngine()` never returned an instance and no later package registered
either.

Same fix both times: wrap each iteration, record that one failure as an
`errorValue()` or a logged skip, and continue. A gap here is a crash, not a
style nit. Audit any new loop with this in mind.

### Preserve the original error

A caught `EngineError` carries a specific code and often
expected/found/suggestion detail. Wrapping just its `.message` throws all of
that away. This shipped once: `evaluateLine()` reduced whatever a parselet threw
to its message and re-threw a generic `EVALUATION_ERROR`, so callers could never
see the real code.

```typescript
// Wrong. Discards code, category, and detail.
} catch (e) {
  throw ErrorFactory.execution("EVALUATION_ERROR", e instanceof Error ? e.message : String(e));
}

// Right.
} catch (e) {
  throw normalizeUnknownError(e);
}
```

`context` is readonly, so to add context you construct a new `EngineError`
copying every other field through. `compileExpression()`'s parse-error branch is
the worked example.

## Adding syntax

Read the trigger-words page in the documentation first. It is the most important
design constraint in the project.

Claiming a common English word as a bare keyword breaks every line of prose that
merely contains it, and makes that word unusable as a variable name. Prefer a
multi-word phrase fused by the normaliser, or require a parenthesis.

Roughly twenty package source files carry a "scope decision" or "trigger-word
collision" note recording exactly this judgement for the words they claim. Read
the nearest one before claiming another word, and add your own when you do.

## Performance

The engine runs on every keystroke, so performance is a correctness concern.
Benchmarks live in `packages/engine/__tests__/benchmarks` and are excluded from
the normal run because they are timing-sensitive.

If a change touches the lexer, the parser, the VM dispatch loop, or any cache,
say so explicitly in the pull request. The parser has a Tier-1 fast path that
bypasses the parselet registry for hot token types; its doc comment lists every
shape exception and states that it is deliberately not a public extension point.

## Comments and types

Documentation comments state the contract a caller needs, because that is what
shows on hover. Implementation reasoning goes in short comments beside the line
it explains, not in the doc block.

Write for someone arriving cold. No history, no dates, no mention of which
session produced something, and no restating what the next line already says.
No em-dashes; use a comma, a colon, parentheses, or a second sentence. This is
checked automatically on changed files.

No escape hatches from the type system. A type that is hard to express usually
means the design needs adjusting rather than the checker needing silencing.

## Testing

A behaviour change needs a test that fails before it and passes after. Bug fixes
get a regression test in `__tests__/bugs` named after the defect.

Examples in the documentation and in the root README are executed by
`__tests__/docs/DocExamples.spec.ts`. If you change what an expression
evaluates to, the docs fail until they are updated, which is the point. Do not
write a documentation example you have not run.

The suite runs against `src` through jest path aliases and never imports
`dist`. That gap once hid a defect where the published bundle threw on import
in Node while every test passed. `scripts/smoke-package.mjs` now covers it, and
anything that could differ between source and bundle belongs there rather than
in jest.
