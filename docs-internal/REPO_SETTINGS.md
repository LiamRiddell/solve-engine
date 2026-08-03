# Repository settings checklist

Settings that live in the GitHub web interface rather than in a file, which is
exactly why they get forgotten. Work through this before the repository goes
public, and again after.

The repository is currently named `Solve-Engine`. That casing is load-bearing:
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
`benchmarks/thresholds.json`, then promote it.

## npm

- [ ] Trusted Publishing (OIDC) configured against this repository, in
      preference to storing a long-lived `NPM_TOKEN` secret
- [ ] Provenance requires a public repository, so publication happens after the
      visibility flip, not before
