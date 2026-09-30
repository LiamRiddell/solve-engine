# Releasing

The release runbook is the documentation site's
[Releasing](https://liamriddell.github.io/solve-engine/contributing/releasing/)
page, kept in the repository at
[`docs/src/content/docs/contributing/releasing.md`](docs/src/content/docs/contributing/releasing.md).
It covers the two-step shape (merging the version pull request, then publishing
a GitHub Release), the preflight, the steps, the release note, the things that
have gone wrong before, and why a version is never published by hand.

This file stays as a pointer so that older links to it keep working. The
mechanism itself is [`.github/workflows/publish.yml`](.github/workflows/publish.yml),
whose comments explain why each step is shaped the way it is.
