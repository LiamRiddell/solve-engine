---
"solve-engine": patch
---

Two of the three runtime dependencies are gone. Installing this package now brings `@tanstack/query-core` and nothing else.

`tslib` was declared and never used. The build is esbuild, which inlines its own helpers rather than calling tslib's, and at this target it emits none at all: the published `1.0.0-beta.1` contains zero references to it across 96 files. `importHelpers` is off now too, so nothing can ask for it again by accident.

`semver` is bundled instead of installed. Three functions are used from it, in one file, and none reach the public type surface, so it is an implementation detail rather than part of the contract. Tree-shaking carries only what those three functions touch, and because a consumer's bundler was already pulling semver in through the external import, the bundled size is within 30 bytes of what it was.

`@tanstack/query-core` stays external on purpose. Its types appear in sixteen shipped declaration files, so inlining the code would leave those pointing at a package the consumer no longer has. It is also the one a consumer might reasonably want to patch or audit, and a bundled dependency can only be updated by a release here.
