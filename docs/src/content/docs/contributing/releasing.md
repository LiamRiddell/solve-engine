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
   `publish` job runs `assert-release-tag` (the tag must match `package.json`),
   then `verify` and `test:consumer` against the packed tarball, and only then
   `npm publish`. Nothing reaches the registry until those pass.

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

- **A red publish run may just be the notify step.** After `npm publish`
  succeeds, the workflow dispatches a downstream notification
  (`notify-obsidian-solve`). That dispatch can fail with a 403 without the
  publish having failed. Check the `publish` job itself, not only the run's
  overall conclusion, before concluding a release did not go out.
- **A benchmark regression on the merge-base job is often noise.** The warm
  micro-cases can report a large regression and, in the same run, a matching
  speed-up on an unrelated case. That pattern is noise, not a real change:
  confirm with a local main-versus-branch comparison, then re-run the job.

## Before adding a public export or a doc example

Two gates run outside `npm run verify` and are easy to miss:

- **Documentation coverage.** Every public export needs a doc block, checked by
  `scripts/check-doc-coverage.mjs` (run in the "Comment style" CI job). Run it
  locally after adding an export.
- **The size stat is built from `dist`.** Regenerate `packageSize.json` only
  after a clean `npm run build`, or the size lint fails on a stale number. It is
  the last step: build, then `npm run stats:size`.
