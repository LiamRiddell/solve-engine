# Contributing

Contributions are welcome. This document covers the practical parts: how to run
the project, what is expected of a change, and where things live.

## Getting set up

```bash
git clone https://github.com/LiamRiddell/Solve-Engine.git
cd Solve-Engine
npm install
npm run verify
```

`npm run verify` is the gate: type check, the full test suite, and the package
build. If it passes locally it should pass in continuous integration, and the
two run the same script deliberately so they cannot drift.

## Layout

| Path | Contents |
| --- | --- |
| `packages/engine` | The published package |
| `packages/playground-bridge` | Shared glue between the engine and the playground |
| `playground` | The interactive playground |
| `docs` | The documentation site |
| `docs-internal` | Maintainer notes, not published |

## What a good change looks like

**Tests.** A behaviour change needs a test that fails before it and passes
after. A bug fix should get a regression test named after the defect, following
the convention in `packages/engine/__tests__/bugs`.

**Documentation.** If you change what an expression evaluates to, update the
syntax reference. Examples in the documentation are executed by the test suite,
so a stale example fails the build rather than misleading a reader.

**Scope.** One concern per pull request. A refactor bundled with a behaviour
change is difficult to review and difficult to revert.

## Conventions

**Errors.** Never throw a bare error. The engine has a structured error type
carrying a code, a category and a recoverability flag, and that taxonomy is what
lets a host tell a user typo apart from an internal fault.

**Comments.** Documentation comments state the contract a caller needs, since
that is what appears on hover. Reasoning about the implementation belongs in
short comments beside the line it explains. Write for someone reading the code
cold: skip the history, and do not restate what the next line already says.
Avoid em-dashes, which is checked automatically on changed files.

**Types.** No escape hatches from the type system. A type that is hard to
express usually means the design needs adjusting rather than the checker needing
silencing.

**Adding syntax.** Read the trigger words page in the documentation first.
Claiming a common English word as a keyword breaks prose that merely mentions
it, and makes that word unusable as a variable name. Prefer a multi-word phrase,
or require a parenthesis.

## Performance

The engine runs on every keystroke, so performance is a correctness concern
rather than a nicety. Benchmarks live in `packages/engine/__tests__/benchmarks`
and are excluded from the normal test run because they are timing-sensitive.

If a change touches the lexer, the parser, the virtual machine dispatch loop, or
any caching layer, say so in the pull request so it gets the attention it
deserves.

## Reporting problems

For something that evaluates incorrectly, the syntax issue form is the fastest
route: give the expression, what you expected, and what you got. That is usually
enough to write a failing test immediately.
