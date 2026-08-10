# Contributing

Contributions are welcome. This document covers the practical parts: how to run
the project, what is expected of a change, and where things live.

## Getting set up

```bash
git clone https://github.com/LiamRiddell/solve-engine.git
cd solve-engine
npm install
npm run verify
```

`npm run verify` is the gate: type check, the full test suite, and the package
build. If it passes locally it should pass in continuous integration, and the
two run the same script deliberately so they cannot drift.

That is everything the engine needs. The documentation site and the playground
need one more step:

```bash
npm run setup
```

### Why that step exists

`npm install` only covers the workspaces, and the workspaces are
`packages/*`. `docs` and `playground` are deliberately outside them: both pull
in a large front-end dependency tree that has no business in the published
package's lockfile, and the playground resolves the engine through path aliases
rather than as a dependency.

So a fresh clone that runs `npm install` and then starts the documentation site
gets an error about a missing import, most recently `mermaid`, which reads as a
broken repository rather than a missing install. `npm run setup` does what
continuous integration does, in the order it does it:

1. build the engine, because the site depends on it through `file:` and that
   package publishes only `dist`. Without this the failure surfaces when Vite
   cannot resolve `solve-engine`, which looks like a documentation problem
2. `npm ci --prefix docs`
3. `npm ci --prefix playground`

Rerun it after pulling changes that touch either project's dependencies, and
after any change to the engine, since `dist` is not in the repository and a
stale one leaves the site running yesterday's engine.

On Windows, stop the dev server first. Astro holds a native binary open inside
`docs/node_modules`, and reinstalling over it fails with `EPERM`.

### Two TypeScript compilers, on purpose

`npm run typecheck` uses **tsgo**, the native compiler that ships as
TypeScript 7. It checks the whole engine in about a second, against roughly two
for the JavaScript compiler.

The `typescript` dependency stays on 5.9 even so, because tsgo cannot replace it
yet. TypeScript 7 dropped the classic compiler API from its main export, and
both of the tools that consume that API need it: `ts-jest` peer-declares
`typescript >=4.3 <7`, and `tsup` uses it to emit the `.d.ts` bundle. So the
JavaScript compiler still does the emitting and the test transform, and tsgo
does the checking.

`npm run typecheck:tsc` runs the same check through the JavaScript compiler. It
is the tie-breaker when the two disagree, which they can: tsgo does not pick up
`@types` packages hoisted to the workspace root the way tsc does, which is why
`packages/engine/tsconfig.json` names `types: ["node"]` explicitly.

The playground is already fully on TypeScript 7, since Vite transpiles and its
`tsc -b` step only type checks.

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

## Releasing

Two steps, on purpose. Nothing a merge does can put a version on npm, because a
published version cannot be replaced and a merge is too easy a thing to do by
accident.

**Describe the change.** Add a changeset in the same pull request as the work:

```bash
npx changeset
```

It asks for a bump type and a description. That description becomes the
changelog entry a stranger reads to decide whether to upgrade, so write it for
them rather than for the diff.

**Cut the release.** Merging to `main` opens a `chore: version packages` pull
request that bumps the version, writes `CHANGELOG.md`, and regenerates the size
figures the documentation site quotes. Review the version and the changelog
there, then merge it. That changes the repository and publishes nothing.

To publish, publish a GitHub Release against a tag matching the version the
pull request just produced (create the tag from the release UI if it does not
exist yet):

```
Tag:     solve-engine@1.0.0-beta.4
Target:  main
```

The tag has to match `packages/engine/package.json` exactly or the workflow
refuses, so release the version commit rather than whatever is on `main` at
the time. Every release publishes to the `latest` dist-tag, prerelease or not:
there is no stable line yet, so a beta is what a plain `npm install
solve-engine` actually gets people, and `latest` sitting several versions
behind was worse than that. A bare tag push, without a release, does not
publish anything.

## Reporting problems

For something that evaluates incorrectly, the syntax issue form is the fastest
route: give the expression, what you expected, and what you got. That is usually
enough to write a failing test immediately.
