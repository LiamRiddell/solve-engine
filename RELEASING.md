# Releasing

How a change gets from a pull request to `npm install solve-engine`.

The mechanism lives in [`.github/workflows/publish.yml`](.github/workflows/publish.yml),
which explains *why* each piece is shaped the way it is. This file is the
operational counterpart: what to do, in order, and what to check when a step
does not behave.

## The shape of it

Releasing is deliberately two events, not one:

| Event | What it does | Reversible? |
|---|---|---|
| Push to `main` | Opens or updates a **"chore: version packages"** pull request | Yes |
| **Publishing a GitHub Release** against `solve-engine@<version>` | Publishes that version to npm | **No** |

A merge cannot publish. That split exists because it used to not: the version
pull request was both the review gate and the trigger, so an ordinary-looking
merge put a version on a registry that does not allow replacing one. The
irreversible step now needs its own deliberate act.

A bare tag push does nothing. Tags can be created early without publishing
anything, which is why `solve-engine@1.0.0-beta.4` and `.beta.5` could exist
briefly without a release behind them.

## Doing a release

### 1. Land the work with a changeset

Every user-visible change needs one. Without it the version pull request has
nothing to bump and the change ships silently under someone else's version.

```bash
npx changeset
```

Pick `patch` for a fix, `minor` for a feature, `major` for a break. The body
becomes the changelog entry that users read, so write it for them rather than
for the diff. State what was wrong, what it does now, and what a caller has to
change.

Verify before pushing. The release job runs the same gate, and finding out
there rather than here costs a cycle:

```bash
npm run verify
```

### 2. Merge the version pull request

Pushing to `main` opens **"chore: version packages"**. It bumps
`packages/engine/package.json`, folds every pending changeset into
`packages/engine/CHANGELOG.md`, deletes the consumed changeset files, and
regenerates the derived size stats.

Read the changelog diff before merging. This is the last point where the
release notes can be fixed cheaply, and it is the artefact most people will
actually read.

Merging changes the repository and nothing else. Nothing is published yet.

### 3. Publish the GitHub Release

Create a release against a tag named exactly `solve-engine@<version>`, matching
the version now sitting in `packages/engine/package.json`. The release UI will
create the tag if it does not exist.

```bash
gh release create "solve-engine@1.0.1" --title "solve-engine 1.0.1" --notes-file <notes>
```

Publishing it runs the publish job, which:

1. checks the tag against `package.json` (`scripts/assert-release-tag.mjs`), so
   a typo cannot publish the previous version under a new name;
2. runs `npm run verify`, the same gate a contributor runs;
3. runs `npm run test:consumer`, which installs the built tarball and uses it,
   because a version cannot be replaced once it is on the registry;
4. publishes to the `latest` dist-tag over OIDC;
5. tells `obsidian-solve` a release shipped, via a repository dispatch carrying
   the bare version.

That last step is gated on the publish job actually succeeding, not merely on
the workflow reaching it. A release that fails `verify` or `test:consumer`, or
that npm rejects, must not tell a downstream consumer a version exists that
never reached the registry.

Draft releases do not publish. The workflow listens for `released: [published]`,
so a draft sits harmlessly until you publish it.

## Things that have actually gone wrong

**The publish job dies in about a second.** npm's trusted publisher
registration carries an optional environment name and a tag policy. If the
policy does not allow `solve-engine@*`, the OIDC token is rejected before
anything useful happens. Check the package's trusted publisher settings on
npmjs.com, not the workflow.

**An authentication error mentioning a missing token.** Trusted publishing
needs npm 11.5.1 or newer, and Node 22 ships npm 10. The job installs a pinned
npm for this reason. The failure does not say "client too old", it says it
cannot find a token.

**Renaming `publish.yml` breaks publishing.** It is registered with npm as the
package's trusted publisher *by filename*. An OIDC token minted by any other
workflow is rejected. This is also why the release trigger lives in this file
rather than a `release.yml` of its own.

**A prerelease went to `latest`.** Every release publishes to `latest`,
prerelease or not. There is no dist-tag derivation, because npm's OIDC
credential is scoped to the `npm publish` call itself and a following
`npm dist-tag add` gets E401. If a narrower `latest` is ever wanted it needs
either a stored token for the second call or two separate publishes.

**A changeset was consumed but its file stayed behind.** The file then folds a
published entry into the *next* version's changelog. Before releasing, check
that each file in `.changeset/` describes something not already in
`CHANGELOG.md`. `readme-and-npm-page-fixes.md` survived its own release at
`1.0.0-beta.7` this way and was removed during 1.0.1.

## Publishing by hand

Don't. There has been exactly one manual publish, `1.0.0-beta.0`, because
trusted publishing cannot create a package that does not exist yet
([npm/cli#8544](https://github.com/npm/cli/issues/8544)). The registration was
added immediately afterwards.
