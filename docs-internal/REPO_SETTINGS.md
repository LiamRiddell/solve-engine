# Repository settings checklist

Settings that live in the GitHub web interface rather than in a file, which is
exactly why they get forgotten. Work through this before the repository goes
public, and again after.

The repository is currently named `solve-engine`. That casing is load-bearing:
the Pages URL derives from it, and `pages.yml` resolves the base path from
`GITHUB_REPOSITORY` rather than hardcoding it, so a rename changes the published
URL but does not break the build. Any hand-written URL in the documentation does
need updating on a rename.

## Before going public

- [ ] Final secret scan over history and the working tree
- [ ] `docs-internal/` contains nothing that should not be read by a stranger.
      The two competitor audits and the engine iteration log live here
      deliberately
- [ ] Description and topics set. Suggested topics: `calculator`,
      `expression-evaluator`, `parser`, `bytecode-vm`, `typescript`,
      `units-of-measure`, `natural-language`
- [ ] Social preview image uploaded

## Pages

- [ ] Settings, Pages, Source set to **GitHub Actions**, not "Deploy from a
      branch". The workflow uploads an artifact and nothing else will pick it up
- [ ] After the first deploy, load the site and confirm the documentation CSS,
      the playground, its font, and its worker chunk all resolve

### When a deploy will not go through

A Pages deployment's id is the commit sha. Once a deployment for a commit ends
in a cancelled or failed state, GitHub will not create a working one for that
same commit again: every retry creates a deployment with the same id, sees it is
already terminal, and cancels in a few seconds with `Error: Deployment
cancelled`. Re-running the job or dispatching the workflow does not help, because
the commit has not changed.

This is easy to walk into. If a deploy is slow, `actions/deploy-pages` aborts at
its ten-minute timeout and cancels its own deployment, which poisons the commit.
Cancelling a queued deploy by hand does the same. The signature to recognise is a
fast cancel rather than a timeout: the backend answered, it just refused the
commit.

The fix is a new commit, which is a new sha and a fresh deployment id. Do not
keep re-running the workflow on the poisoned commit. A slow-but-working backend
is different: that one eventually succeeds, so let it run rather than cancelling
it.

## Security

- [ ] Private vulnerability reporting enabled. `SECURITY.md` sends people to the
      advisory form, which does not exist until this is on
- [ ] Secret scanning enabled
- [ ] Push protection enabled
- [ ] Dependabot alerts and security updates enabled

## Collaboration

- [ ] Discussions enabled. The issue template config links to it, so leaving it
      off produces a dead link on the new-issue page
- [ ] Labels created to match the issue forms: `syntax`, `bug`, `enhancement`
- [ ] Branch protection on `main`: require the CI checks, require a pull request

## Branch protection and the benchmark job

Leave the benchmark comparison **non-required** for the first month. It compares
against the merge base on the same runner, which cancels most machine variance,
but the false-positive rate is unknown until it has run against real pull
requests. A performance gate that flaps gets disabled within two weeks, and a
disabled gate protects nothing. Watch it, calibrate the thresholds in
`packages/engine/benchmarks/thresholds.json`, then promote it.

## Actions

- [x] Settings, Actions, General, Workflow permissions: **Allow GitHub Actions
      to create and approve pull requests** is on. Off by default, and the
      symptom is specific: the release workflow builds the version branch,
      pushes it, and then fails with `GitHub Actions is not permitted to create
      or approve pull requests`. The `pull-requests: write` grant in the
      workflow cannot override it, because this setting sits above the token.
      With it off, somebody has to open the version pull request by hand from
      the `changeset-release/main` branch every release. Turned on 2026-08-05,
      after exactly that happened. Confirmed with
      `gh api repos/LiamRiddell/solve-engine/actions/permissions/workflow`,
      which reports it as `can_approve_pull_request_reviews`, a name that does
      not obviously cover creating them

## npm

- [ ] Trusted Publishing (OIDC) configured against this repository, in
      preference to storing a long-lived `NPM_TOKEN` secret
- [ ] The trusted publisher registration names **`publish.yml`** and the `npm`
      environment. It binds to the workflow filename, so renaming that file, or
      moving publishing into a different one, makes npm reject the token. This
      is why the tag trigger lives in `publish.yml` alongside the version job
      rather than in a release workflow of its own
- [x] The `npm` environment's deployment branch and tag policy allows the tag
      the release actually pushes, `solve-engine@*`. This is easy to miss because
      the failure looks nothing like a policy problem: the publish job fails in
      about a second with no steps run and no runner assigned, since GitHub
      rejects the deployment before it starts. The policy allowed `main` and
      `v*`, left from the original `v1.0.0-beta.0` tag, but `#45` moved the
      scheme to `solve-engine@<version>` and nothing updated the environment.
      Added 2026-08-06 when `solve-engine@1.0.0-beta.3` hit exactly this. The
      stale `v*` entry is harmless and was left in place. Inspect with
      `gh api repos/LiamRiddell/solve-engine/environments/npm/deployment-branch-policies`
- [ ] Provenance requires a public repository, so publication happens after the
      visibility flip, not before
- [ ] `beta` dist-tag points at a release that actually works. It pointed at
      `1.0.0-beta.0` long after that version was found to be published empty
