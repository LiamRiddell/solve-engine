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
  with a changeset in `.changeset/`, a `minor` or `patch` entry written in the
  same voice as these pages.
- **Pushing to `main` opens a version pull request.** The changeset bot keeps a
  single "Version packages" pull request open, bumping the version in
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

2. **Verify the version bump locally before trusting the bot.** Version-pull-
   request CI can be green and the bump still be wrong, because the pull
   request's own diff is not the same thing as running the bump. On a throwaway
   branch:

   ```bash
   npx changeset version
   ```

   Check that `packages/engine/package.json` shows the intended version and that
   `packages/engine/CHANGELOG.md` reads correctly, in the house voice, with the
   real test counts. Then discard the branch. Reset any generated files rather
   than committing them.

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
   then `npm run verify:ci`, every gate a pull request has to pass, ending with
   the packed tarball installed and used, and only then `npm publish`. Nothing
   reaches the registry until all of those pass.

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

## Things that look like failures but are not

- **A benchmark regression on the merge-base job is often noise.** The warm
  micro-cases can report a large regression and, in the same run, a matching
  speed-up on an unrelated case. That pattern is noise, not a real change:
  confirm with a local main-versus-branch comparison, then re-run the job.

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
  machine; the gzip figure is measured on the Node version in `.nvmrc`, and a
  different Node can compress the same bytes to a slightly different count.
- **The test stats are read from the last full run.** `stats:tests` reads the
  report `npm run test:full` writes, so run the full suite first.
