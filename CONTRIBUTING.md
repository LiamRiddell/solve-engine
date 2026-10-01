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

`npm run verify` is the fast loop: the type check, the default test run, and
the package build. It is what to run while iterating.

`npm run verify:ci` is the gate. It is every check continuous integration
applies, as one command: lint (source, tests and tools), comment style, doc
coverage, action pins, licences, the dependency audit, the type check, every
test suite including the four slow ones the fast loop skips, the test-count
stats, the build, the smoke checks, publint, the size figures, the generated
unit reference, the sidebar, and the packed tarball installed into a scratch
project and used. Continuous integration runs those same named scripts, split
across jobs for speed, and a release runs the whole command again before
anything reaches npm. If `verify:ci` passes locally, the pull request passes;
`npm run lint:ci-parity`, part of the command, fails when one of its scripts
is run by no pull-request job, so the two cannot drift. Two gates sit outside
it: the coverage floor, measured daily by its own workflow because the
measurement is slow (`npm run test:coverage` runs it locally), and the tests
that call a real network service, run daily with `SOLVE_LIVE_NETWORK=1` set
(`npm run test:live` locally), so a slow third party cannot fail a gate.

Run it before pushing anything that touches the lexer vocabulary, a unit, the
public exports, the docs examples or the bundle. It takes several minutes;
that is the price of not finding out from the job log.

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

`npm run typecheck` uses **TypeScript 7's `tsc`**, the native compiler,
installed under the alias `typescript7` (`npm:typescript@7.0.2`). It checks
the whole engine in about a second. It replaced `tsgo` from the dated
`@typescript/native-preview` build once TypeScript 7 became `latest` on npm.

The `typescript` dependency stays on 5.9 even so, because TypeScript 7 cannot
replace it yet. Its root export is a version file rather than the classic
compiler API, and both of the tools that consume that API need it: `ts-jest`
peer-declares `typescript >=4.3 <7`, and `tsup` uses it to emit the `.d.ts`
bundle. So TypeScript 5.9 still does the emitting and the test transform, and
TypeScript 7 does the checking. The alias is what keeps the two apart: ts-jest
resolves `typescript`, which stays 5.9, and the script calls TypeScript 7's
`tsc` by its path.

`npm run typecheck:tsc` runs the same check through TypeScript 5.9. It is the
tie-breaker when the two disagree. Neither 7's `tsc` nor the preview before it
picks up `@types` packages hoisted to the workspace root the way 5.9 does, which
is why `packages/engine/tsconfig.json` names `types: ["node"]` explicitly.

`npm run typecheck:tests` type-checks the spec files and `tools/` with the
same TypeScript 7 compiler, over `packages/engine/tsconfig.tests.json`. ts-jest
transpiles each spec without checking it, so a type error in a test was never
reported, and 248 had built up. The check compares the errors per file with
`packages/engine/__tests__/typecheck-baseline.json`: a file with more errors
than its baseline fails, and fewer rewrites the baseline lower, which you commit.
Import Jest's globals from `@jest/globals`, as every spec does; `fail` is not a
Jest 30 global, so assert on a captured error instead.

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

### Adding syntax

Every feature in the engine is a package, arithmetic included, and a package
touches at least eight places before it can be judged. One command writes all
of them:

```bash
npm run new:package -- fuel-economy --group "Units"
```

What comes out registers, evaluates something, and passes `npm run verify`
before you edit a line, so the first thing you change is the behaviour rather
than the wiring. The [package author guide](https://liamriddell.github.io/solve-engine/packages/authoring-a-package/)
explains each extension point it leaves you.

## What a good change looks like

**Tests.** A behaviour change needs a test that fails before it and passes
after. A bug fix should get a regression test named after the defect, following
the convention in `packages/engine/__tests__/bugs`.

**Documentation.** If you change what an expression evaluates to, update the
syntax reference. Examples in the documentation are executed by the test suite,
so a stale example fails the build rather than misleading a reader.

**The Obsidian plugin.** CI builds and tests
[obsidian-solve](https://github.com/LiamRiddell/obsidian-solve) against the
engine a pull request builds, in the optional `obsidian-canary` job. A red
canary does not block a merge; it says the change will need a plugin change. It
builds nothing while the plugin pins a different major of the engine.

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
Avoid em-dashes, which is checked automatically (`npm run lint:comments`).

**Messages.** An error message or a warning is prose a reader sees, so it follows
the house voice too: no em-dash, British spelling, no JavaScript operator, and
no host method named in a line's result (say what is missing instead: "needs a
document"). `npm run lint:messages` checks the messages written as literals.

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

**Check first.** `npm run release:check` is a read-only preflight: npm's
versions against the changelog and the GitHub releases, publish runs still in
flight or cancelled, the pending changesets, a throwaway `changeset version`, and
a release-note skeleton. It needs the network and `gh`.

**Cut the release.** Merging to `main` opens a `chore: version packages` pull
request that bumps the version, writes `CHANGELOG.md`, and regenerates every
figure the documentation site quotes: the test counts, the unit reference and
the size. Review the version and the changelog there, then merge it. That
changes the repository and publishes nothing.

To publish, publish a GitHub Release against a tag matching the version the
pull request just produced (create the tag from the release UI if it does not
exist yet):

```
Tag:     solve-engine@1.0.0-beta.4
Target:  main
```

The tag has to match `packages/engine/package.json` exactly, sit on `main`,
and leave no changeset waiting, or the workflow refuses; so release the version
commit rather than whatever is on `main` at the time. The workflow then runs
`npm run verify:ci` against that commit, packs the release once, installs and
uses that tarball, and publishes that same file. A version
publishes to the `latest` dist-tag, and npm refuses to move `latest` to a
version lower than the one it names, so re-running an old release cannot take
`latest` backwards. A prerelease (a version with a `-` part) publishes to
`next`. A bare tag push, without a release, does not publish anything.

## Reporting problems

For something that evaluates incorrectly, the syntax issue form is the fastest
route: give the expression, what you expected, and what you got. That is usually
enough to write a failing test immediately.
