---
title: Versioning and support
description: What semantic versioning promises for this package, how deprecations are handled, and which Node versions are tested.
---

Solve follows [semantic versioning](https://semver.org/). This page says what
that promise covers, because "semver" on its own leaves the questions that
matter open: which surface it applies to, how long a deprecated name lives, and
which Node versions a release is checked on.

## What the version number promises

- **Patch** (`2.23.0` to `2.23.1`): a fix. An expression that evaluated
  correctly before evaluates the same; one that evaluated wrongly may now
  evaluate correctly, and the changelog names it.
- **Minor** (`2.23.0` to `2.24.0`): something new, or a repair that changes what
  an expression displays. Existing code compiles and runs unchanged. A change
  to a displayed result (the digit grouping on a quantity, say) is a minor with
  a before/now table in the changelog, because a host that stores rendered
  strings will see it.
- **Major**: a public export is removed or changes shape, or an expression that
  evaluated one way evaluates another for a reason other than a fix.
  [Upgrading to 2](/guide/upgrading-to-2/) is the record of the last one.

## Which surface

The promise covers the **public** entry points listed on
[subpath exports](/guide/subpath-exports/): the root, `engine`, `vm`, `format`,
`language`, `packages`, `constants`, `worker`, `engine-worker`, `temporal` and
`testing`. The **advanced**
entry points (`lexer`, `parser`, `normalizer`, `resolvers`, `errors`,
`utilities`, `uom`, `services`) are public too, but they expose the pipeline
internals a package author extends, so they move more often; the same rule
applies, an addition is a minor and a removal is a major. Anything not exported
is internal and carries no promise.

A member marked `@internal` in its doc comment is not covered either, even on
an exported class. `ExpressionEngine` has a set of these: the seams its own
incremental evaluator and language service call, which a host has no reason to
and which change with the evaluator. Some are also marked `@deprecated`, where
calling one can change the engine's answers, and name what to use instead. The
published types still carry them in 2.x; they leave in 3.0. The members a host
may call are listed in [embedding](/guide/embedding/#the-rest-of-the-engine).

Error codes are part of the surface: a code a host can receive today keeps its
name, and a new one is a minor. Every code the engine and its built-in packages
answer with is listed on [error codes](/guide/error-codes/), and in the package
as `ERROR_CODE_CATALOGUES`; a test fails when one is renamed or removed. Error
*messages* are prose for a person and may be reworded in a patch.

Expression results are part of the surface too, which is why the syntax
reference is proven by the test suite: every documented result is one the
engine produces, and a change to one is a changelog entry.

## Deprecation

A name that is going away is marked `@deprecated` in its doc comment, which
editors show on hover, with the replacement named. It keeps working for at least
one minor release after the mark and is removed in the next major. The changelog
entry that marks it and the one that removes it both name the replacement.

## Node and platforms

The package declares `node >= 22`. Every pull request and every release runs
the test suite on Node 22 and Node 24, runs every suite including the slow
ones on Node 22, and installs the packed tarball into a scratch project on both.
That is the tested set; the floor moves only in a major. The engine itself opens
no sockets, reads no files and depends on no DOM, so it runs unchanged in a
browser and in a worker. The [security](/guide/security/) page lists the two
packages that fetch, and the switch that stops them.

## Where changes are recorded

Every version has an entry in the package changelog,
`packages/engine/CHANGELOG.md`, written from the changeset each pull request
ships with, and a [GitHub release](https://github.com/LiamRiddell/solve-engine/releases)
carrying the same note with its verification section. Those two are the
record; a change that is in neither has not shipped.
