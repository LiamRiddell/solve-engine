---
"solve-engine": patch
---

The published README and npm package description now match the repository's, and the origin-check and control-character-regex CodeQL fixes actually reach npm.

`latest` has been stuck on `1.0.0-beta.2` since it was accidentally published there instead of `beta`, so npm's package page (and `npm install solve-engine` with no tag) has been showing that old version's README the whole time, regardless of what landed on `main` since. This patch is what finally moves `latest` forward under the simplified always-publish-to-latest release policy.
