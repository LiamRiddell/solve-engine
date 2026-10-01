---
title: Releasing
description: How a version reaches npm, and the checks that gate it.
---

Releasing is deliberately two acts, not one. Merging to `main` prepares a
release; publishing a GitHub Release performs it. The split exists so that an
ordinary merge can never put a version on the registry, which does not allow
replacing one. The irreversible step has its own deliberate act.

## The shape of it

- **Changesets accumulate.** Every change that should appear in the notes ships
  with a changeset in `.changeset/`, a `major`, `minor` or `patch` entry written
  in the same voice as these pages; `major` is reserved for a breaking API change.
- **Pushing to `main` opens a version pull request.** The changeset bot keeps a
  single "chore: version packages" pull request open, bumping the version in
  `package.json` and writing the changelog from the accumulated changesets. It
  regenerates on every push, so it always reflects the changesets currently on
  `main`.
- **Merging that pull request changes the repository and nothing else.** The
  version and changelog land on `main`. No publish happens.
- **Publishing a GitHub Release against a `solve-engine@<version>` tag
  publishes that version to npm.** This is the only workflow npm accepts a
  release from: it is the package's registered trusted publisher, so an OIDC
  token minted by any other workflow is rejected. A bare tag push does nothing.

## The steps

Assume the pull requests that belong in the release are merged to `main` and
green.

1. **Confirm the milestone is clear.** The release's GitHub milestone should have
   no open issues, and every feature pull request should be merged.

2. **Run the preflight.** It gathers what used to be checked by hand, and
   changes nothing:

   ```bash
   npm run release:check
   ```

   It compares npm's versions and dist-tags with `package.json`, and lists every
   changelog heading and GitHub release npm does not have (2.38.29 and 2.39.1
   were both in the changelog and never on npm, and nothing said so). It lists
   publish runs still queued or in progress, and release runs that were
   cancelled, since re-running one publishes that version. It lists the pending
   changesets and the version they add up to, then runs a throwaway
   `changeset version` in a temporary worktree with its own install, which is
   the one release step pull-request CI never runs, and removes the worktree.
   Last, it drafts a release-note skeleton ending in `## Verification` with the
   test and suite counts from `docs/src/data/testStats.json`; the prose is still
   written by hand.

   It needs the network and `gh`, so it is a maintainer's script rather than a
   CI gate; without `gh` it names the GitHub checks as skipped.
   `-- --skip-version` leaves out the throwaway version, and `-- --offline`
   leaves out npm and GitHub as well.

   Check that the version the throwaway bump reports is the intended one, and
   that `packages/engine/CHANGELOG.md` will read correctly, in the house voice.

3. **Merge the version pull request.** This writes the version bump and the
   changelog to `main`. Confirm afterwards:

   ```bash
   node -e "console.log(require('./packages/engine/package.json').version)"
   ```

   The `.changeset/` directory should now hold only its `README`, every entry
   consumed.

4. **Publish the GitHub Release.** Create a release against a tag named
   `solve-engine@<version>` matching the version now in `package.json`, targeting
   `main`. The release UI (or `gh release create`) creates the tag if it does not
   exist. The title is `solve-engine <version>`; the body is the release note.

   ```bash
   gh release create "solve-engine@<version>" --target main \
     --title "solve-engine <version>" --notes-file <notes>
   ```

5. **Watch the publish workflow.** The release triggers `publish.yml`. Its
   `publish` job checks that the tag sits on `main`, runs `assert-release-tag`
   (the tag must match `package.json`, and no changeset may still be waiting),
   then `npm run verify:ci`, every gate a pull request has to pass. It then
   packs the release once, into a known folder, checks the packed contents with
   `assert-publishable`, installs that tarball into a scratch project and uses
   it, and publishes that same file with `npm publish <tarball>`. Publishing a
   file rather than the folder means npm runs no lifecycle script in between,
   so what reaches the registry is the build that was installed and used, not a
   second one. Nothing reaches the registry until all of those pass.

6. **Confirm the version is live.**

   ```bash
   npm view solve-engine version
   ```

## The release note

A release note follows the same voice as the changelog and these pages: state
what changed in a plain sentence, then show it with a `before / now` table or an
`expression    result` block, using real results the engine produces. British
spelling. A substantial note ends with a `## Verification` section citing the
real test and suite counts (from `docs/src/data/testStats.json`) and the gates
that ran. The published `solve-engine@1.0.0`, `1.0.2` and `1.2.0` releases are
the reference for tone and structure.

## Things that have actually gone wrong

- **The publish job dies in about a second.** npm's trusted publisher
  registration carries an optional environment name and a tag policy. If the
  policy does not allow `solve-engine@*`, the OIDC token (the short-lived
  credential GitHub hands the workflow in place of a stored npm token) is
  rejected before anything useful happens. Check the package's trusted
  publisher settings on npmjs.com, not the workflow.
- **An authentication error mentioning a missing token.** Trusted publishing
  needs npm 11.5.1 or newer, and the Node the job runs ships an older npm, so
  the job installs a pinned npm first. The failure does not say the client is
  too old; it says it cannot find a token.
- **Renaming `publish.yml` breaks publishing.** It is registered with npm as the
  package's trusted publisher *by filename*, so an OIDC token minted by any
  other workflow is rejected. This is also why the release trigger lives in that
  file rather than in a `release.yml` of its own.
- **A release would move `latest` backwards.** The publish step passes no
  `--tag` for an ordinary version, so npm applies `latest` itself and refuses a
  version lower than the one already there. That is what makes re-running an
  old, cancelled release safe: it fails rather than taking `latest` back (#622).
  A prerelease goes to `next`. Each publish has one target, because npm's OIDC
  credential is scoped to the `npm publish` call itself, and a following
  `npm dist-tag add` gets E401.
- **A changeset was consumed but its file stayed behind.** The file then folds
  an entry already published into the *next* version's changelog. Before
  releasing, check that each file in `.changeset/` describes something not
  already in `CHANGELOG.md`. `readme-and-npm-page-fixes.md` survived its own
  release at `1.0.0-beta.7` this way and was removed during 1.0.1.

## Publishing by hand

Don't. There has been exactly one manual publish, `1.0.0-beta.0`, because
trusted publishing cannot create a package that does not exist yet
([npm/cli#8544](https://github.com/npm/cli/issues/8544)). The trusted publisher
registration was added immediately afterwards, and every version since has gone
through `publish.yml`.

## Things that look like failures but are not

- **A benchmark regression on the first measurement is often noise.** The warm
  micro-cases can report a large regression and, in the same run, a matching
  speed-up on an unrelated case. The job no longer fails on that alone: it
  measures each over-limit case again, base and branch interleaved, and fails
  only if the median is still over, so a red benchmark check is a confirmed
  regression. The comment shows both measurements.

## The regenerated figures

Three files under `docs/src/data/` are derived rather than written, and each
has a check that fails when the committed copy has drifted: `testStats.json`
(`lint:stats`), `packageSize.json` (`lint:size`) and the unit reference page
(`lint:units`). The version pull request regenerates all three, so a release
always carries figures produced from its own tree.

A feature pull request that moves one of them regenerates it too. `npm run
verify:ci` runs every check, so the drift is caught before pushing rather than
in the job log. Two things to know when regenerating:

- **The size stat is built from `dist`.** Regenerate `packageSize.json` only
  after a clean `npm run build`, or the check fails on a stale number. The
  tarball is packed under a pinned npm, so that figure is the same on every
  machine; the brotli figure is measured on the exact Node version in `.nvmrc`
  (a full version such as `22.22.2`, not a major), and a different Node can
  compress the same bytes to a slightly different count. The CI job that checks
  the figure and the release jobs that regenerate it all read `.nvmrc`. Moving
  the pin means regenerating the figures in the same change.
- **The test stats are read from the last full run.** `stats:tests` reads the
  report `npm run test:full` writes, so run the full suite first.
