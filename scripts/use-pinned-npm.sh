#!/bin/sh
# Puts the pinned npm first on the PATH of the steps that follow, in a GitHub
# Actions job.
#
# Trusted publishing needs npm 11.5.1 or newer, and the Node the release job
# runs ships an older one. The pin is installed beside the runner's npm, in its
# own directory, and put first on PATH. It is not installed over it with
# `npm install -g npm@...`: that makes the running npm replace its own files
# part-way through its own install, and the old npm then asks for a module the
# new one no longer ships. That failed the 2.44.0 publish on its first step
# ("Cannot find module 'promise-retry'"), before anything reached npm.
#
# Pinned, not `@latest`. This runs in the job holding `id-token: write`, so
# whatever it installs can mint a publishing credential for the package, and
# `@latest` would mean that code is chosen at run time by whoever last
# published npm, with no review and no way to notice a change.
#
# Used by publish.yml, and by the `package` job in ci.yml on the same Node, so
# a break here is met on a pull request and not in the middle of a release.
set -eu

version="12.0.2"
# Both are checked before anything is installed: an install nothing can then
# put on the PATH is wasted, and says nothing about why.
runner_temp="${RUNNER_TEMP:?RUNNER_TEMP is not set: this runs inside a GitHub Actions job}"
github_path="${GITHUB_PATH:?GITHUB_PATH is not set: this runs inside a GitHub Actions job}"
dir="${runner_temp}/npm-${version}"

npm install --prefix "$dir" --no-save --ignore-scripts --no-audit --no-fund "npm@${version}"
echo "${dir}/node_modules/.bin" >> "$github_path"

installed="$("${dir}/node_modules/.bin/npm" --version)"
if [ "$installed" != "$version" ]; then
  echo "::error::Installed npm ${installed}, expected ${version}."
  exit 1
fi
echo "npm ${installed} is first on PATH for the steps that follow."
